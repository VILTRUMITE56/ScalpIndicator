// Render the versioned candidate core identically into the Indie indicator and strategy.
// `--check` verifies the checked-in scripts have not drifted from the generated blocks.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const specPath = path.join(root, 'research/specs/candidate_contract_p1.json');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const readLf = file => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');

function values() {
  const rules = spec.shared_signal_rules;
  const risk = spec.planned_entry_risk_contract;
  return {
    expiry_last: String(rules.expiry_bars_after_touch.last_inclusive),
    target_r: String(risk.target_multiple_r),
    minimum_stop_atr: String(risk.minimum_stop_distance_atr),
    long_invalidation_atr: String(risk.long_invalidation_offset_atr),
    long_stop_reference_atr: String(risk.long_stop_reference_offset_atr),
    short_invalidation_atr: String(risk.short_invalidation_offset_atr),
    short_stop_reference_atr: String(risk.short_stop_reference_offset_atr),
    stop_cap_atr: String(risk.maximum_stop_distance_atr),
    cost_r_cap: String(risk.maximum_cost_to_risk),
    contract_version: spec.contract_version,
    limit_offset: String(spec.execution_separation.strategy_limit_offset_fraction),
  };
}

function renderTemplate(name) {
  let output = readLf(path.join(root, 'research/templates', name));
  for (const [key, value] of Object.entries(values())) output = output.replaceAll(`{{${key}}}`, value);
  if (/\{\{[^}]+\}\}/.test(output)) throw new Error(`Unfilled placeholder in ${name}`);
  return output.trimEnd();
}

const generated = {
  'indie/btc_pullback_indicator_p1.indie': {
    block: `${renderTemplate('shared_candidate_core.indie.in')}\n${renderTemplate('indicator_candidate_adapter.indie.in')}`,
    legacyStart: '        if self.is_new_bar:\n            self._trend_event = False',
    legacyEnd: '        trend_bars[0] = trend_bars[1]',
    markerStart: '        # BEGIN GENERATED SHARED CANDIDATE CORE',
    markerEnd: '        # END GENERATED INDICATOR CANDIDATE ADAPTER',
  },
  'indie/btc_pullback_strategy_p1.indie': {
    block: `${renderTemplate('shared_candidate_core.indie.in')}\n${renderTemplate('strategy_candidate_adapter.indie.in')}\n\n        return entry_fast[0], entry_slow[0], htf_fast[0], htf_slow[0]\n`,
    legacyStart: '        if self.is_new_bar and (not profile_valid or data_gap or (at_higher_boundary and not complete_higher_bar)):',
    legacyEnd: '        return entry_fast[0], entry_slow[0], htf_fast[0], htf_slow[0]',
    markerStart: '        # BEGIN GENERATED SHARED CANDIDATE CORE',
    markerEnd: '        # END GENERATED STRATEGY EXECUTION ADAPTER',
    trailing: '\n\n        return entry_fast[0], entry_slow[0], htf_fast[0], htf_slow[0]',
  },
};

const sharedCore = renderTemplate('shared_candidate_core.indie.in');
const sharedCoreSha256 = crypto.createHash('sha256').update(sharedCore).digest('hex');

function replaceBlock(source, entry) {
  const begin = source.indexOf(entry.markerStart);
  if (begin >= 0) {
    const end = source.indexOf(entry.markerEnd, begin);
    if (end < 0) throw new Error('Generated block end marker is missing');
    let blockEnd = end + entry.markerEnd.length;
    if (entry.trailing && source.startsWith(entry.trailing, blockEnd)) blockEnd += entry.trailing.length;
    let suffix = source.slice(blockEnd);
    if (entry.trailing && suffix.trim() === '') suffix = '';
    return source.slice(0, begin) + entry.block + suffix;
  }
  const start = source.indexOf(entry.legacyStart);
  const end = source.indexOf(entry.legacyEnd, start);
  if (start < 0 || end < 0) throw new Error('Could not locate the frozen legacy candidate block');
  const endAfter = end + entry.legacyEnd.length;
  let suffix = source.slice(endAfter);
  if (entry.trailing && suffix.trim() === '') suffix = '';
  return source.slice(0, start) + entry.block + suffix;
}

function addCandidateIdState(source) {
  const initStart = source.indexOf('    def __init__');
  const calcStart = source.indexOf('\n    def calc', initStart);
  if (initStart < 0 || calcStart < 0) throw new Error('Could not locate script constructor for shared state fields');
  const initSection = source.slice(initStart, calcStart);
  const fields = [
    ["_last_candidate_id", "''"],
    ['_trend_event', 'False'],
    ['_pullback_event', 'False'],
    ['_trigger_event', 'False'],
    ['_invalidated_event', 'False'],
    ['_expired_event', 'False'],
  ];
  const missing = fields.filter(([name]) => !initSection.includes(`self.${name} =`));
  if (missing.length === 0) return source;
  const anchor = '        self._last_htf_boundary_complete = False';
  const index = source.indexOf(anchor, initStart);
  if (index < 0) throw new Error('Could not add candidate ID state beside HTF state');
  const end = index + anchor.length;
  const lines = missing.map(([name, value]) => `\n        self.${name} = ${value}`).join('');
  return source.slice(0, end) + lines + source.slice(end);
}

const check = process.argv.includes('--check');
const write = process.argv.includes('--write');
if (check === write || process.argv.length > 3) throw new Error('Pass exactly one of --check or --write');

const outputs = [];
for (const [relative, entry] of Object.entries(generated)) {
  const file = path.join(root, relative);
  const original = readLf(file);
  let actual = replaceBlock(original, entry);
  actual = addCandidateIdState(actual);
  if (!actual.includes(sharedCore)) throw new Error(`${relative} is missing the rendered shared core`);
  if (check) {
    if (actual !== original) throw new Error(`${relative} has drifted from generated P1 blocks`);
  } else {
    fs.writeFileSync(file, actual, 'utf8');
  }
  outputs.push({ path: relative, sha256: crypto.createHash('sha256').update(actual).digest('hex') });
}
console.log(JSON.stringify({ contract_version: spec.contract_version, mode: check ? 'check' : 'write', shared_core_sha256: sharedCoreSha256, generated_sources: outputs }, null, 2));

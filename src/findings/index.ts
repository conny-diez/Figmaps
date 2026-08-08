/**
 * Epic C — running the rule set.
 *
 * Findings are sorted by severity and capped at `ENGINE_CONFIG.findings.maxShown`
 * (C-1). Sorting is stable within a severity: the order of `RULES` decides, so
 * the same screen always produces the same list in the same order.
 */
import { ENGINE_CONFIG } from '../engine/config'
import { RULES } from './rules'
import { SEVERITY_ORDER, type Finding, type FindingsInput } from './types'

export function collectFindings(input: FindingsInput): Finding[] {
  const found: Finding[] = []
  for (const rule of RULES) {
    const finding = rule.evaluate(input)
    if (finding) found.push(finding)
  }

  return found
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => SEVERITY_ORDER[b.finding.severity] - SEVERITY_ORDER[a.finding.severity] || a.index - b.index)
    .slice(0, ENGINE_CONFIG.findings.maxShown)
    .map((entry) => entry.finding)
}

export { RULES, formatPercent, isPrimaryCandidate } from './rules'
export * from './types'

import type { VeteranAnswer } from "../agent/answerSchema.ts";

export type Rule = "code" | "file-path" | "identifier" | "sql" | "stack-trace" | "secret" | "deny-term" | "email";

export interface Finding {
  /** Field path in the answer, e.g. `branches[1].behavior`. */
  field: string;
  rule: Rule;
  /** The text that matched; kept in the transcript and the regeneration feedback, never printed. */
  match: string;
}

export interface CheckedField {
  field: string;
  text: string;
}

/** The fields support reads. `internalReferences` is for developers and `versionCaveat` comes from the profile. */
export function userFacingFields(answer: VeteranAnswer): CheckedField[] {
  const fields: CheckedField[] = [{ field: "answer", text: answer.answer }];
  answer.branches.forEach((branch, index) => {
    fields.push({ field: `branches[${index}].condition`, text: branch.condition });
    fields.push({ field: `branches[${index}].behavior`, text: branch.behavior });
  });
  answer.suggestedTests.forEach((text, index) => fields.push({ field: `suggestedTests[${index}]`, text }));
  if (answer.clarifyingQuestion !== null) fields.push({ field: "clarifyingQuestion", text: answer.clarifyingQuestion });
  answer.dependsOn.forEach((text, index) => fields.push({ field: `dependsOn[${index}]`, text }));
  answer.caveats.forEach((text, index) => fields.push({ field: `caveats[${index}]`, text }));
  return fields;
}

const CODE_EXTENSIONS =
  "cs|csproj|sln|vb|cshtml|razor|aspx|ascx|config|ts|tsx|js|jsx|mjs|cjs|py|java|kt|go|rb|php|sql|json|ya?ml|xml|toml|ini|env|dll|exe|sh|ps1|bat|cmd|html?|css|scss|md|txt|log|properties|gradle|lock|resx";

const CAMEL = "[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+|[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*";
const SNAKE = "[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+";

/** Regex rules over one field's text. `secret` is gitleaks' job (`secrets.ts`); `deny-term` comes from the profile. */
const PATTERNS: { rule: Rule; pattern: RegExp }[] = [
  { rule: "code", pattern: /`+[^`]*`*/g },
  // A path with at least one separator that ends in an extension, or a bare file name with a code extension.
  { rule: "file-path", pattern: /(?:[A-Za-z]:)?(?:[\w.-]+[\\/])+[\w.-]*\.[A-Za-z0-9]{1,6}\b/g },
  { rule: "file-path", pattern: new RegExp(`\\b[\\w-]+\\.(?:${CODE_EXTENSIONS})\\b`, "gi") },
  { rule: "identifier", pattern: new RegExp(`\\b(?:${CAMEL}|${SNAKE})(?:(?:\\.[A-Za-z_]\\w*)+\\(?|\\()`, "g") },
  { rule: "identifier", pattern: /\b[A-Za-z_]\w*\.[A-Za-z_]\w*\(/g },
  { rule: "identifier", pattern: /\b[A-Za-z_]\w*\(\)/g },
  { rule: "sql", pattern: /\bselect\b[^\n]*\bfrom\b|\binsert\s+into\b|\bupdate\b[^\n]*\bset\b|\bdelete\s+from\b|\bjoin\b[^\n]*\bon\b/gi },
  { rule: "stack-trace", pattern: /\bat\s+[\w$<>.]+\.[\w$<>]+\s*\([^\n]*/g },
  { rule: "stack-trace", pattern: /\b(?:[A-Za-z_]\w*\.)*[A-Z]\w*(?:Exception|Error)\b/g },
  { rule: "stack-trace", pattern: /Traceback \(most recent call last\)|\bFile "[^"]+", line \d+/g },
  { rule: "email", pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
];

/** Every regex and deny-term finding in the answer's user-facing fields, in field order. */
export function deterministicFindings(answer: VeteranAnswer, denyTerms: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const { field, text } of userFacingFields(answer)) {
    const own: Finding[] = [];
    for (const { rule, pattern } of PATTERNS) {
      for (const match of text.matchAll(pattern)) own.push({ field, rule, match: match[0] });
    }
    const lower = text.toLowerCase();
    for (const term of denyTerms) {
      const at = lower.indexOf(term.toLowerCase());
      if (at >= 0) own.push({ field, rule: "deny-term", match: text.slice(at, at + term.length) });
    }
    // One leak, one finding: drop repeats, and matches inside a longer match of the same rule.
    const sameRule = (a: Finding, b: Finding) => a.rule === b.rule;
    findings.push(
      ...own.filter(
        (finding, index) =>
          own.findIndex((other) => sameRule(other, finding) && other.match === finding.match) === index &&
          !own.some((other) => sameRule(other, finding) && other.match !== finding.match && other.match.includes(finding.match)),
      ),
    );
  }
  return findings;
}

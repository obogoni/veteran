/** The structured answer the agent must return. `versionCaveat` is added by Veteran, never asked of the model. */
export interface VeteranAnswer {
  answer: string;
  branches: { condition: string; behavior: string }[];
  suggestedTests: string[];
  clarifyingQuestion: string | null;
  confidence: "high" | "medium" | "low";
  dependsOn: string[];
  caveats: string[];
  /** Files, symbols or tables the agent relied on. Kept in the transcript for developers; never shown to support. */
  internalReferences: string[];
}

const stringList = { type: "array", items: { type: "string" } };

export const ANSWER_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "answer",
    "branches",
    "suggestedTests",
    "clarifyingQuestion",
    "confidence",
    "dependsOn",
    "caveats",
    "internalReferences",
  ],
  properties: {
    answer: { type: "string" },
    branches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["condition", "behavior"],
        properties: { condition: { type: "string" }, behavior: { type: "string" } },
      },
    },
    suggestedTests: stringList,
    clarifyingQuestion: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    dependsOn: stringList,
    caveats: stringList,
    internalReferences: stringList,
  },
};

const FIELDS = ANSWER_SCHEMA.required as string[];

/** Problems that make `value` not a `VeteranAnswer`; empty when it is one. */
export function answerProblems(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return ["the answer is not an object"];
  const data = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(data)) if (!FIELDS.includes(key)) problems.push(`${key}: unexpected field`);
  for (const field of FIELDS) if (!(field in data)) problems.push(`${field}: missing`);

  if ("answer" in data && typeof data.answer !== "string") problems.push("answer: expected a string");
  for (const field of ["suggestedTests", "dependsOn", "caveats", "internalReferences"]) {
    if (field in data && !isStringList(data[field])) problems.push(`${field}: expected a list of strings`);
  }
  if ("branches" in data) {
    const branches = data.branches;
    const valid =
      Array.isArray(branches) &&
      branches.every(
        (branch) =>
          branch !== null &&
          typeof branch === "object" &&
          Object.keys(branch).length === 2 &&
          typeof (branch as Record<string, unknown>).condition === "string" &&
          typeof (branch as Record<string, unknown>).behavior === "string",
      );
    if (!valid) problems.push("branches: expected a list of { condition, behavior } strings");
  }
  if ("clarifyingQuestion" in data && data.clarifyingQuestion !== null && typeof data.clarifyingQuestion !== "string") {
    problems.push("clarifyingQuestion: expected a string or null");
  }
  if ("confidence" in data && !["high", "medium", "low"].includes(data.confidence as string)) {
    problems.push("confidence: expected high, medium or low");
  }
  return problems;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * The `excludePaths` dialect: repo-relative, `/`-separated, case-sensitive.
 * Only `*` (never crosses `/`) and `**` (crosses `/`) are wildcards; every other
 * character matches literally. A pattern that matches a directory excludes its subtree.
 */
export type PathMatcher = (path: string) => boolean;

export function compileExcludes(patterns: readonly string[]): PathMatcher {
  const expressions = patterns.map(toRegExp);
  const matchesAny = (path: string) => expressions.some((expression) => expression.test(path));
  return (path) => {
    const segments = path.split("/");
    for (let length = segments.length; length > 0; length--) {
      if (matchesAny(segments.slice(0, length).join("/"))) return true;
    }
    return false;
  };
}

function toRegExp(pattern: string): RegExp {
  const segments = pattern.replace(/\/+$/, "").split("/");
  let source = "";
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === "**") {
      // `**/` at the start or between segments: zero or more whole directories.
      // A trailing `**` is covered by the subtree rule, but must still match one or more segments.
      source += last ? (index === 0 ? ".*" : "/.*") : index === 0 ? "(?:.*/)?" : "/(?:.*/)?";
      return;
    }
    if (index > 0 && segments[index - 1] !== "**") source += "/";
    source += segment
      .split("**")
      .map((part) => part.split("*").map(escapeRegExp).join("[^/]*"))
      .join(".*");
  });
  return new RegExp(`^${source}$`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

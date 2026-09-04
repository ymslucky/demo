/** Join truthy class names with spaces (tiny classnames alternative). */
export function cx(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}

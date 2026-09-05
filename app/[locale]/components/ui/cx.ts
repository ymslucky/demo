/** 将真值 class 名用空格连接（classnames 的极简替代品）。 */
export function cx(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}

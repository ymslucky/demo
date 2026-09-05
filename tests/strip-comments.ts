import * as ts from "typescript";

/**
 * Strips every comment (line, block, JSDoc) while keeping string literals,
 * JSX text and identifiers intact. Comments may be written in Chinese, so
 * CJK scans must only ever see real code content. JSX is preserved (not
 * lowered to createElement calls) so JSX text nodes stay visible.
 */
export function stripComments(src: string, fileName: string): string {
  return ts.transpileModule(src, {
    fileName,
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ESNext,
      removeComments: true,
    },
  }).outputText;
}

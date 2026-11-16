import ts from "typescript";
export function validateChangedSyntax(
  path: string,
  original: string,
  updated: string,
) {
  if (original === updated) return;
  if (/\.(?:[cm]?[jt]sx?)$/i.test(path)) {
    const options = {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        jsx: ts.JsxEmit.Preserve,
        allowJs: true,
      },
    };
    const errors = (text: string) =>
      (ts.transpileModule(text, options).diagnostics || []).filter(
        (d) => d.category === ts.DiagnosticCategory.Error,
      );
    if (!errors(original).length && errors(updated).length)
      throw new Error(
        `The approved replacement makes ${path} invalid code. No export was released. Start a new review and amend the replacement.`,
      );
  } else if (/\.json$/i.test(path)) {
    try {
      JSON.parse(original);
    } catch {
      return;
    }
    try {
      JSON.parse(updated);
    } catch {
      throw new Error(
        `The approved replacement makes ${path} invalid JSON. No export was released. Start a new review and amend the replacement.`,
      );
    }
  }
}

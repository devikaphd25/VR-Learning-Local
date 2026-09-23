/**
 * Runs Python code in the browser using Pyodide (CPython compiled to
 * WebAssembly).  Loaded once from CDN and cached for all subsequent calls.
 * Returns real Python stdout and error messages so the jigsaw puzzle
 * feedback shows exactly what Python would report.
 */

let pyodidePromise: Promise<any> | null = null;

async function getPyodide(): Promise<any> {
  if (pyodidePromise) return pyodidePromise;

  pyodidePromise = (async () => {
    // Inject the Pyodide bootstrap script from CDN if not already present.
    if (!(window as any).loadPyodide) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src =
          "https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.js";
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error("Could not load the Python compiler (Pyodide)."));
        document.head.appendChild(script);
      });
    }

    const pyodide = await (window as any).loadPyodide();
    return pyodide;
  })();

  return pyodidePromise;
}

export interface PythonResult {
  success: boolean;
  output: string;
  error: string;
}

export async function runPython(code: string): Promise<PythonResult> {
  try {
    const pyodide = await getPyodide();

    // Redirect stdout/stderr into string buffers so we can capture output.
    pyodide.runPython(`
      import sys, io
      sys.stdout = io.StringIO()
      sys.stderr = io.StringIO()
    `);

    try {
      pyodide.runPython(code);
      const output = String(pyodide.runPython("sys.stdout.getvalue()"));
      return { success: true, output, error: "" };
    } catch (err: any) {
      // Grab any partial stdout that was produced before the error.
      let partial = "";
      try {
        partial = String(pyodide.runPython("sys.stdout.getvalue()"));
      } catch {
        /* ignore */
      }

      // Pyodide wraps Python tracebacks in its own JS error.  Extract just
      // the Python-relevant portion (from the error type line onward).
      let errorMsg: string = err?.message ?? String(err);
      const lines = errorMsg.split("\n");
      const errorLine = lines.findIndex((l: string) =>
        /^\s*(NameError|SyntaxError|IndentationError|TypeError|ValueError|ZeroDivisionError|IndexError|KeyError|AttributeError|RuntimeError|UnboundLocalError):/.test(
          l,
        ),
      );
      if (errorLine >= 0) {
        errorMsg = lines.slice(errorLine).join("\n").trim();
      }

      return { success: false, output: partial, error: errorMsg };
    }
  } catch (err: any) {
    return {
      success: false,
      output: "",
      error:
        "Could not start the Python compiler.\n" +
        (err?.message ?? String(err)),
    };
  }
}

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, "..");

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === "server-only") {
    return {
      shortCircuit: true,
      url: "data:text/javascript,export {};",
    };
  }

  if (specifier.startsWith("@/")) {
    const relativePath = specifier.slice(2);
    const resolvedPath = path.join(repoRoot, `${relativePath}.ts`);
    return defaultResolve(pathToFileURL(resolvedPath).href, context, defaultResolve);
  }

  return defaultResolve(specifier, context, defaultResolve);
}

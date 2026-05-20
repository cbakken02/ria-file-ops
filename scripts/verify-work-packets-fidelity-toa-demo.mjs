import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

if (
  !process.env.WORK_PACKETS_VERIFY_DEMO_REEXEC &&
  !process.execArgv.includes("--experimental-strip-types")
) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--loader",
      "./tests/ts-alias-loader.mjs",
      SCRIPT_PATH,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WORK_PACKETS_VERIFY_DEMO_REEXEC: "true",
      },
      stdio: "inherit",
    },
  );
  process.exit(result.status ?? 1);
}

const {
  JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH,
} = await import("../lib/work-packets/dev-demo/jon-smith-fidelity-toa.ts");
const {
  JonSmithFidelityToaVerificationError,
  verifyJonSmithFidelityToaOutputPdf,
} = await import("../lib/work-packets/dev-demo/fidelity-toa-output-verification.ts");

try {
  const result = await verifyJonSmithFidelityToaOutputPdf(
    JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH,
  );

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "passed" ? 0 : 1);
} catch (error) {
  const code =
    error instanceof JonSmithFidelityToaVerificationError
      ? error.code
      : "unknown_error";

  console.error(
    JSON.stringify(
      {
        status: "error",
        code,
        outputPdfPath: JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH,
        safeMessage:
          error instanceof Error
            ? error.message
            : "Dev-only Fidelity TOA verification failed.",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

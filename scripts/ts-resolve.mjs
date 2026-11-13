// Lets Node run our TypeScript scripts directly (Node 26 strips types natively) by
// resolving extensionless relative imports like "./booking-db" to "./booking-db.ts",
// the way the Next.js bundler and Vitest already do. No extra dependency needed.
//
// Usage: node --conditions=react-server --import ./scripts/ts-resolve.mjs scripts/<script>.ts
// (--conditions=react-server makes `server-only` resolve to its empty module, as on the server.)
import { registerHooks } from "node:module";

const RELATIVE = /^\.{1,2}\//;
const HAS_EXTENSION = /\.[cm]?[jt]sx?$|\.json$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error?.code === "ERR_MODULE_NOT_FOUND" && RELATIVE.test(specifier) && !HAS_EXTENSION.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

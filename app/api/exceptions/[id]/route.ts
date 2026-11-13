// POST /api/exceptions/[id] (human actions on an exception: Approve / Block Seller).
// Owner: Cooper. See SPEC.md sections 8 and 10.
import { approveException, blockSeller } from "@/lib/booking";
import { getDb } from "@/lib/booking-db";

type Context = { params: Promise<{ id: string }> };

const ACTIONS = { approve: approveException, block_seller: blockSeller } as const;
type Action = keyof typeof ACTIONS;

// exceptions.exception_id is a uuid; anything else can't exist, so it's a 404, not a database error.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const error = (status: number, message: string) => Response.json({ error: message }, { status });

async function readAction(req: Request): Promise<Action | null> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return null; // missing or invalid JSON
  }
  if (typeof body !== "object" || body === null || !("action" in body)) return null;
  const { action } = body;
  return action === "approve" || action === "block_seller" ? action : null;
}

export async function POST(req: Request, { params }: Context): Promise<Response> {
  const action = await readAction(req);
  if (!action) return error(400, 'body must be {"action": "approve"} or {"action": "block_seller"}');

  const { id } = await params;
  if (!UUID.test(id)) return error(404, "exception not found");

  try {
    const db = getDb();
    const exception = await db.getException(id);
    if (!exception) return error(404, "exception not found");
    if (exception.status !== "open") return error(409, `exception already handled (status ${exception.status})`);
    if (exception.order_id === null) {
      // The stolen-key case: there's no order to book or seller to block. Resolving it isn't built.
      return error(409, `a ${exception.type} exception has no order, so it can't be approved or blocked`);
    }

    // null means someone else resolved it between our read and the action's conditional update.
    const entry = await ACTIONS[action](id, db);
    if (!entry) return error(409, "exception already handled");

    const updated = await db.getException(id);
    if (!updated) throw new Error(`exception ${id} disappeared after ${action}`);
    return Response.json({ exception: updated }, { status: 200 });
  } catch (cause) {
    // Full detail goes to the server log only; the response never carries messages, stacks or keys.
    console.error(`POST /api/exceptions/${id} (${action}) failed:`, cause);
    return error(500, "internal error");
  }
}

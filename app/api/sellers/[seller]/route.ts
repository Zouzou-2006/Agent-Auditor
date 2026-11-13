// /api/sellers/[seller] (the three fake x402 sellers). Owner: Fabi. See SPEC.md section 6.
// DataCo is live. CheapData and SketchyNews come next and answer 404 until then.
import { handleDataCo } from "@/lib/sellers/dataco";

type Context = { params: Promise<{ seller: string }> };

export async function GET(req: Request, { params }: Context): Promise<Response> {
  const { seller } = await params;
  switch (seller) {
    case "dataco":
      return handleDataCo(req);
    default:
      return Response.json({ error: `unknown seller ${seller}` }, { status: 404 });
  }
}

// The gateway may call with POST; it's handled the same way (inputs come from the query string).
export const POST = GET;

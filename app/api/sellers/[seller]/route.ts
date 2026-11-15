// /api/sellers/[seller] (the three fake x402 sellers). Owner: Fabi. See SPEC.md section 6.
// DataCo (beat 1) and CheapData (beat 2) are live. SketchyNews comes next and answers 404 until then.
import { handleCheapData } from "@/lib/sellers/cheapdata";
import { handleDataCo } from "@/lib/sellers/dataco";

type Context = { params: Promise<{ seller: string }> };

export async function GET(req: Request, { params }: Context): Promise<Response> {
  const { seller } = await params;
  switch (seller) {
    case "dataco":
      return handleDataCo(req);
    case "cheapdata":
      return handleCheapData(req);
    default:
      return Response.json({ error: `unknown seller ${seller}` }, { status: 404 });
  }
}

// The gateway may call with POST; it's handled the same way (inputs come from the query string).
export const POST = GET;

import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "./lib/auth";
export function proxy(request: NextRequest) {
  if (!process.env.KENOBI_USERS || !process.env.KENOBI_ORIGIN)
    return new NextResponse(
      "Kenobi requires KENOBI_USERS and KENOBI_ORIGIN. See the deployment README.",
      { status: 503 },
    );
  if (!authenticate(request))
    return new NextResponse(
      "Sign in with your Kenobi username and access key.",
      {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Kenobi", charset="UTF-8"',
          "Cache-Control": "no-store",
        },
      },
    );
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://*.blob.vercel-storage.com https://blob.vercel-storage.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  );
  return response;
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|\\.well-known/workflow/).*)",
  ],
};

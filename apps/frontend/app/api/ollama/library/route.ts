import { LIBRARY_URL, parseLibrary, parseModelDetails } from "../library";

/** Models that can be installed, for the install field's suggestions. A public page, so no user data is sent. */
export async function GET(request: Request) {
  const family = new URL(request.url).searchParams.get("family");
  if (family !== null && (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(family) || family.includes(".."))) {
    return Response.json({ message: "Invalid model family." }, { status: 400 });
  }
  try {
    const url = family ? `${LIBRARY_URL}/${family}/tags` : LIBRARY_URL;
    const response = await fetch(url, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(15_000), redirect: "error" });
    if (!response.ok) throw new Error("Library unavailable");
    const html = await response.text();
    if (family) {
      const details = parseModelDetails(html, family);
      if (!details.description && !Object.keys(details.sizes).length) throw new Error("Tags page changed");
      return Response.json(details);
    }

    const models = parseLibrary(html);
    if (!models.length) throw new Error("Library page changed");
    return Response.json({ models });
  } catch {
    return Response.json({ message: "Could not load the model list." }, { status: 502 });
  }
}

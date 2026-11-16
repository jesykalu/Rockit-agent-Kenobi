import { get, put } from "@vercel/blob";
export async function cachedRange<T>(
  jobId: string,
  key: string,
  produce: () => Promise<T>,
  validate: (value: unknown) => T,
): Promise<{ value: T; hit: boolean }> {
  const path = `reviews/${jobId}/analysis-cache/${key}.json`;
  const stored = await get(path, { access: "private" });
  if (stored && stored.statusCode === 200)
    return {
      value: validate(await new Response(stored.stream).json()),
      hit: true,
    };
  const value = validate(await produce());
  await put(path, JSON.stringify(value), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return { value, hit: false };
}

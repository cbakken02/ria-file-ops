export function buildAppUrl(pathname: string, request: Request) {
  const configuredBaseUrl = process.env.NEXTAUTH_URL?.trim();

  if (configuredBaseUrl) {
    return new URL(pathname, configuredBaseUrl).toString();
  }

  return new URL(pathname, request.url).toString();
}

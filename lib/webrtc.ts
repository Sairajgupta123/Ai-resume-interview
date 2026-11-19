export function getInterviewIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const turnUrls = process.env.NEXT_PUBLIC_TURN_URL?.split(",").map(value => value.trim()).filter(Boolean) ?? [];
  if (turnUrls.length) {
    const username = process.env.NEXT_PUBLIC_TURN_USERNAME;
    const credential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;
    servers.push({
      urls: turnUrls,
      ...(username ? { username } : {}),
      ...(credential ? { credential } : {})
    });
  }
  return servers;
}

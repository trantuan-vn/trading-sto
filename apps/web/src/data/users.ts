import { decodeJWT } from "@/lib/utils";
// Interface cho user data - giữ nguyên tất cả fields
export interface User {
  id: string | null;
  identifier: string | null;
}
export function getUserFromToken(token?: string): User | null {
  if (!token) {
    console.error("Token is missing");
    return null;
  }
  const userData = decodeJWT(token);
  if (!userData) {
    console.error("Invalid token format or cannot decode JWT");
    return null;
  }
  return {
    id: userData.sub,
    identifier: userData.identifier,
  };
}

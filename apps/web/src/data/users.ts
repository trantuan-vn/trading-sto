// Interface cho user data - giữ nguyên tất cả fields
export interface User {
  provider: string | null;
  id: string | null;
  identifier: string | null;
  address: string | null;
  name?: string;
  phone?: string;
  email?: string;
  avatar?: string;
  role?: string;
}
export async function getUserFromAPI(cookieHeader: string): Promise<User | null> {
  const response = await fetch('https://api.unitoken.trade/api/me', {
    method: 'GET',
    headers: {
      'Cookie': cookieHeader,
      'Content-Type': 'application/json',
    },
  });
  console.log(response.ok);
  if (!response.ok) return null;
  const userData: User = await response.json();
  console.log(userData);
  return {
    provider: userData.provider ?? null,
    id: userData.id ?? null,
    identifier: userData.identifier ?? '',
    address: userData.address ?? null,
    name: userData.name,
    phone: userData.phone,
    email: userData.email,
    avatar: userData.avatar,
    role: userData.role
  };
}

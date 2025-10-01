import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Context, Next } from 'hono'
import type { UserDO } from './UserDO.js'
import { decodeJWT } from './jwt-utils.js'

const isRequestSecure = (c: Context) => new URL(c.req.url).protocol === 'https:'

const setCookieWithOption = (c: Context, name: string, value: string, maxAge: number) => {
  const cookieOptions = {
    sameSite: 'none' as const, 
    httpOnly: true,
    secure: true,
    path: '/',
    domain: '.unitoken.trade',
    maxAge: maxAge,
  };
  setCookie(c, name, value, cookieOptions);
};

export type GetUserDO = (c: Context, identifier: string) => UserDO

export function createAuthMiddleware(getUserDO: GetUserDO, logPrefix = '') {
  return async (c: Context, next: Next) => {
    const token = getCookie(c, 'token') || ''
    const refreshToken = getCookie(c, 'refreshToken') || ''

    const prefix = logPrefix ? `[${logPrefix}] ` : ''
    
    // Luôn xóa user cũ trước khi xác thực lại
    c.set('user', undefined)

    if (token || refreshToken) {
      try {
        const identifier =
          decodeJWT(token)?.identifier?.toLowerCase() ||
          decodeJWT(refreshToken)?.identifier?.toLowerCase()

        if (identifier) {
          const userDO = getUserDO(c, identifier)
          
          // Tối ưu 1: Kiểm tra token expiration trước khi verify
          const tokenPayload = decodeJWT(token)
          const refreshTokenPayload = decodeJWT(refreshToken)
          
          const isTokenExpired = tokenPayload?.exp && tokenPayload.exp < Date.now() / 1000
          const isRefreshTokenExpired = refreshTokenPayload?.exp && refreshTokenPayload.exp < Date.now() / 1000

          let result: { ok: boolean; user?: any } = { ok: false }

          // Case 1: Token còn hạn → verify luôn
          if (token && !isTokenExpired) {
            result = await userDO.verifyToken({ token })
            console.log(`🔑 ${prefix}Token verification for ${identifier}:`, { success: result.ok })
          }
          // Case 2: Token hết hạn nhưng refresh token còn hạn → refresh
          else if (refreshToken && !isRefreshTokenExpired) {
            console.log(`🔄 ${prefix}Token expired, attempting refresh...`)
            try {
              const { token: newToken } = await userDO.refreshToken({ refreshToken })
              setCookieWithOption(c, "token", newToken, 10*60);
              result = await userDO.verifyToken({ token: newToken })
              console.log(`✅ ${prefix}Token refreshed successfully`)
            } catch (e) {
              console.log(`❌ ${prefix}Token refresh failed:`, e)
              deleteCookie(c, 'token')
              deleteCookie(c, 'refreshToken')
            }
          }
          // Case 3: Cả hai đều hết hạn → clear auth
          else {
            console.log(`❌ ${prefix}All tokens expired`)
            deleteCookie(c, 'token')
            deleteCookie(c, 'refreshToken')
          }

          if (result.ok && result.user) {
            console.log(`👤 ${prefix}User set: ${result.user.identifier}`)
            c.set('user', result.user)
          }
        } else {
          // Không có identifier hợp lệ
          deleteCookie(c, 'token')
          deleteCookie(c, 'refreshToken')
        }
      } catch (e) {
        console.error(`${prefix}Auth error:`, e)
        deleteCookie(c, 'token')
        deleteCookie(c, 'refreshToken')
      }
    }

    await next()
  }
}

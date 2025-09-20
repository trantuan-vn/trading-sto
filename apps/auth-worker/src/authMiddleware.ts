import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Context, Next } from 'hono'
import type { UserDO } from './UserDO.js'
import { decodeJWT } from './jwt-utils.js'

const isRequestSecure = (c: Context) => new URL(c.req.url).protocol === 'https:'

export type GetUserDO = (c: Context, identifier: string) => UserDO

export function createAuthMiddleware(getUserDO: GetUserDO, logPrefix = '') {
  return async (c: Context, next: Next) => {
    const url = new URL(c.req.url)
    const token = getCookie(c, 'token') || ''
    const refreshToken = getCookie(c, 'refreshToken') || ''

    const prefix = logPrefix ? `[${logPrefix}] ` : ''
    console.log(`🔐 ${prefix}Auth check for ${url.pathname}:`, {
      hasToken: !!token,
      hasRefreshToken: !!refreshToken
    })

    if (token || refreshToken) {
      try {
        const identifier =
          decodeJWT(token)?.identifier?.toLowerCase() ||
          decodeJWT(refreshToken)?.identifier?.toLowerCase()

        if (identifier) {
          const userDO = getUserDO(c, identifier)
          let result = await userDO.verifyToken({ token })
          console.log(`🔑 ${prefix}Token verification for ${identifier}:`, { success: result.ok })

          if (!result.ok && refreshToken) {
            try {
              console.log(`🔄 ${prefix}Attempting token refresh...`)
              const { token: newToken } = await userDO.refreshToken({ refreshToken })
              setCookie(c, 'token', newToken, {
                httpOnly: true,
                secure: isRequestSecure(c),
                path: '/',
                sameSite: 'Lax'
              })
              result = await userDO.verifyToken({ token: newToken })
              console.log(`✅ ${prefix}Token refreshed successfully`)
            } catch (e) {
              console.log(`❌ ${prefix}Token refresh failed:`, e)
              deleteCookie(c, 'token')
              deleteCookie(c, 'refreshToken')
            }
          }

          if (result.ok && result.user) {
            console.log(`👤 ${prefix}User set: ${result.user.identifier}`)
            c.set('user', result.user)
          }
        }
      } catch (e) {
        console.error(`${prefix}Auth error:`, e)
      }
    }

    await next()
  }
}

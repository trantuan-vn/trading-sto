import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  isConnected: boolean
  address: string | null
  nonce: string | null
  setConnected: (address: string) => void
  setDisconnected: () => void
  setNonce: (nonce: string) => void
  clearNonce: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isConnected: false,
      address: null,
      nonce: null,
      setConnected: (address: string) => set({ isConnected: true, address }),
      setDisconnected: () => set({ isConnected: false, address: null, nonce: null }),
      setNonce: (nonce: string) => set({ nonce }),
      clearNonce: () => set({ nonce: null }),
    }),
    {
      name: 'auth-storage',
    }
  )
)
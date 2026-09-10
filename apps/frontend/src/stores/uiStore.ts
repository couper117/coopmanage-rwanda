import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TableDensity = 'comfortable' | 'compact'

interface UiState {
  /** Desktop sidebar collapsed to an icon rail. */
  sidebarCollapsed: boolean
  /** Mobile off-canvas drawer. Never persisted: it should not be open on a fresh load. */
  mobileNavOpen: boolean
  density: TableDensity
  toggleSidebar: () => void
  setMobileNavOpen: (open: boolean) => void
  setDensity: (density: TableDensity) => void
}

/**
 * Client state only. Server data lives in TanStack Query; nothing here caches a list of records.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      density: 'comfortable',
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
      setDensity: (density) => set({ density }),
    }),
    {
      name: 'coopmanage.ui',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        density: state.density,
      }),
    },
  ),
)

export interface TrajectoryOptions { curvature?: number; learningRate?: number; momentum?: number; steps?: number }
export interface TrustOptions { largeWeight?: number; update?: number; learningRate?: number; decay?: number; capped?: boolean }
export interface SpectrumOptions { large?: number; small?: number; steps?: number; method?: 'jordan' | 'classical' }
export function createResearchVisualRuntime(): {
  kinds: string[]
  trajectory(options?: TrajectoryOptions): { name: string; points: { x: number; y: number; loss: number }[]; stopped: boolean }[]
  layerTrust(options?: TrustOptions): { weight: number; candidate: number; ratio: number; adamRelative: number; lambRelative: number }[]
  spectrum(options?: SpectrumOptions): { original: number[]; approximate: number[]; ideal: number[]; matrices: number[][]; error: number }
  mount(root: ParentNode): () => void
}

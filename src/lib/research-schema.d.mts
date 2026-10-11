import type { ResearchEntry, ResearchDocument } from '../types'
export function validateResearchCatalog(value: unknown): { schemaVersion: 1; reports: ResearchEntry[] }
export function validateResearchDocument(value: unknown, expected?: ResearchEntry): ResearchDocument

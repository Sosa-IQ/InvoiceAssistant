import type { CatalogItem, CatalogRecommendation } from "@/types/invoice"
import api from "./client"

type CatalogItemPayload = Omit<CatalogItem, "id" | "user_id" | "created_at" | "updated_at">

export async function listCatalog(search?: string): Promise<CatalogItem[]> {
  const { data } = await api.get<CatalogItem[]>("/api/catalog", { params: search ? { search } : {} })
  return data
}

export async function createCatalogItem(body: CatalogItemPayload): Promise<CatalogItem> {
  const { data } = await api.post<CatalogItem>("/api/catalog", body)
  return data
}

export async function updateCatalogItem(id: number, body: Partial<CatalogItemPayload>): Promise<CatalogItem> {
  const { data } = await api.put<CatalogItem>(`/api/catalog/${id}`, body)
  return data
}

export async function deleteCatalogItem(id: number): Promise<void> {
  await api.delete(`/api/catalog/${id}`)
}

export async function recommendCatalogItems(): Promise<CatalogRecommendation[]> {
  const { data } = await api.post<CatalogRecommendation[]>("/api/catalog/recommendations")
  return data
}

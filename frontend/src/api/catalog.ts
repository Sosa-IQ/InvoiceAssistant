import type { CatalogItem } from "@/types/invoice"
import api from "./client"

export async function listCatalog(search?: string): Promise<CatalogItem[]> {
  const { data } = await api.get<CatalogItem[]>("/api/catalog", { params: search ? { search } : {} })
  return data
}

export async function createCatalogItem(body: Omit<CatalogItem, "id" | "created_at" | "updated_at">): Promise<CatalogItem> {
  const { data } = await api.post<CatalogItem>("/api/catalog", body)
  return data
}

export async function updateCatalogItem(id: number, body: Partial<Omit<CatalogItem, "id" | "created_at" | "updated_at">>): Promise<CatalogItem> {
  const { data } = await api.put<CatalogItem>(`/api/catalog/${id}`, body)
  return data
}

export async function deleteCatalogItem(id: number): Promise<void> {
  await api.delete(`/api/catalog/${id}`)
}

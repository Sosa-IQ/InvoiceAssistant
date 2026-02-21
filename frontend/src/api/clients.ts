import type { Client, ClientAddress } from "@/types/invoice"
import api from "./client"

export async function listClients(search?: string): Promise<Client[]> {
  const { data } = await api.get<Client[]>("/api/clients", { params: search ? { search } : {} })
  return data
}

export async function createClient(body: Omit<Client, "id" | "created_at" | "updated_at" | "addresses">): Promise<Client> {
  const { data } = await api.post<Client>("/api/clients", body)
  return data
}

export async function updateClient(id: number, body: Partial<Omit<Client, "id" | "created_at" | "updated_at" | "addresses">>): Promise<Client> {
  const { data } = await api.put<Client>(`/api/clients/${id}`, body)
  return data
}

export async function deleteClient(id: number): Promise<void> {
  await api.delete(`/api/clients/${id}`)
}

export async function createClientAddress(
  clientId: number,
  body: { label?: string; address: string },
): Promise<ClientAddress> {
  const { data } = await api.post<ClientAddress>(`/api/clients/${clientId}/addresses`, body)
  return data
}

export async function updateClientAddress(
  clientId: number,
  addressId: number,
  body: { label?: string; address: string },
): Promise<ClientAddress> {
  const { data } = await api.put<ClientAddress>(`/api/clients/${clientId}/addresses/${addressId}`, body)
  return data
}

export async function deleteClientAddress(clientId: number, addressId: number): Promise<void> {
  await api.delete(`/api/clients/${clientId}/addresses/${addressId}`)
}

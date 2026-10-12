export async function saveProviderStatus(adminClient, transaction, changes) {
  const { data, error } = await adminClient.from('external_payment_transactions')
    .update(changes)
    .eq('organization_id', transaction.organization_id)
    .eq('id', transaction.id)
    .neq('status', 'succeeded')
    .neq('settlement_status', 'settled')
    .select('*').maybeSingle()
  if (error) throw error
  if (data) return data
  const current = await adminClient.from('external_payment_transactions')
    .select('*').eq('organization_id', transaction.organization_id).eq('id', transaction.id).single()
  if (current.error) throw current.error
  return current.data
}

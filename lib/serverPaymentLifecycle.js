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

export async function markSettlementFailure(adminClient, transaction, message) {
  const { error } = await adminClient.from('external_payment_transactions').update({
    settlement_status: 'reconciliation_required',
    settlement_result: { settled: false, error: message },
    updated_at: new Date().toISOString(),
  }).eq('id', transaction.id).eq('organization_id', transaction.organization_id)
    .neq('settlement_status', 'settled')
  if (error) throw error
}

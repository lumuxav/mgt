export async function requirePaymentTargetAccess(check, targetType, targetId) {
  const { data, error } = await check.scopedClient.rpc('mgt_payment_target_access', {
    p_type: targetType,
    p_id: targetId || null,
  })
  if (error) throw error
  if (data !== true) throw new Error('This payment is outside your assigned work scope.')
}

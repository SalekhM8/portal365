import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function isBlank(value: string | null | undefined): boolean {
  return !value || String(value).trim().length === 0
}

function parseEmergencyContact(raw: string | null | undefined): any {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    const text = String(raw)
    if (!text.trim()) return {}
    const parts = text.split('/')
    return {
      name: parts[0]?.trim() || text.trim(),
      phone: parts[1]?.trim() || '',
      relationship: ''
    }
  }
}

function normalizeEmergencyContact(input: any): {
  name: string
  phone: string
  relationship: string
  addressInfo: { address: string; postcode: string }
} {
  if (!input || typeof input !== 'object') {
    return {
      name: '',
      phone: '',
      relationship: '',
      addressInfo: { address: '', postcode: '' }
    }
  }

  const addressInfo = input.addressInfo && typeof input.addressInfo === 'object'
    ? input.addressInfo
    : {}

  return {
    name: String(input.name || ''),
    phone: String(input.phone || ''),
    relationship: String(input.relationship || ''),
    addressInfo: {
      address: String(addressInfo.address || input.address || ''),
      postcode: String(addressInfo.postcode || input.postcode || '')
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')

  const childMemberships = await prisma.membership.findMany({
    where: {
      familyGroupId: { not: null },
      isPrimaryMember: false
    },
    select: {
      userId: true,
      familyGroupId: true,
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          emergencyContact: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  })

  const parentIds = Array.from(
    new Set(
      childMemberships
        .map((m) => m.familyGroupId)
        .filter((id): id is string => Boolean(id))
    )
  )

  const parents = await prisma.user.findMany({
    where: { id: { in: parentIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      emergencyContact: true
    }
  })
  const parentById = new Map(parents.map((p) => [p.id, p]))

  const previewRows: Array<Record<string, string>> = []
  let candidates = 0
  let updated = 0

  for (const membership of childMemberships) {
    const child = membership.user
    const parent = membership.familyGroupId ? parentById.get(membership.familyGroupId) : null
    if (!parent) continue

    const childEc = normalizeEmergencyContact(parseEmergencyContact(child.emergencyContact))
    const parentEc = normalizeEmergencyContact(parseEmergencyContact(parent.emergencyContact))

    const nextPhone = isBlank(child.phone) ? (parent.phone || '') : (child.phone || '')
    const mergedEc = {
      name: childEc.name || parentEc.name,
      phone: childEc.phone || parentEc.phone || parent.phone || '',
      relationship: childEc.relationship || parentEc.relationship || 'parent',
      addressInfo: {
        address: childEc.addressInfo.address || parentEc.addressInfo.address,
        postcode: childEc.addressInfo.postcode || parentEc.addressInfo.postcode
      }
    }

    const shouldUpdatePhone = isBlank(child.phone) && !isBlank(nextPhone)
    const shouldUpdateEmergency =
      (
        isBlank(childEc.name) && !isBlank(mergedEc.name)
      ) ||
      (
        isBlank(childEc.phone) && !isBlank(mergedEc.phone)
      ) ||
      (
        isBlank(childEc.relationship) && !isBlank(mergedEc.relationship)
      ) ||
      (
        isBlank(childEc.addressInfo.address) && !isBlank(mergedEc.addressInfo.address)
      ) ||
      (
        isBlank(childEc.addressInfo.postcode) && !isBlank(mergedEc.addressInfo.postcode)
      )

    if (!shouldUpdatePhone && !shouldUpdateEmergency) continue
    candidates += 1

    previewRows.push({
      childName: `${child.firstName} ${child.lastName}`.trim(),
      childEmail: child.email,
      parentEmail: parent.email,
      setPhone: shouldUpdatePhone ? nextPhone : 'no',
      setAddress: shouldUpdateEmergency ? (mergedEc.addressInfo.address || 'no') : 'no',
      setPostcode: shouldUpdateEmergency ? (mergedEc.addressInfo.postcode || 'no') : 'no',
      setEmergencyName: shouldUpdateEmergency ? (mergedEc.name || 'no') : 'no'
    })

    if (apply) {
      await prisma.user.update({
        where: { id: child.id },
        data: {
          ...(shouldUpdatePhone ? { phone: nextPhone } : {}),
          ...(shouldUpdateEmergency ? { emergencyContact: JSON.stringify(mergedEc) } : {})
        }
      })
      updated += 1
    }
  }

  console.log(`Mode: ${apply ? 'APPLY' : 'PREVIEW'}`)
  console.log(`Family children scanned: ${childMemberships.length}`)
  console.log(`Candidates needing backfill: ${candidates}`)
  if (previewRows.length > 0) {
    console.table(previewRows.slice(0, 100))
    if (previewRows.length > 100) {
      console.log(`...and ${previewRows.length - 100} more row(s)`)
    }
  }

  if (apply) {
    console.log(`Updated children: ${updated}`)
  } else {
    console.log('No DB writes performed. Re-run with --apply to persist changes.')
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

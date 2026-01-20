/**
 * Update user details (phone, address, emergency contact) in production
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const usersToUpdate = [
  { email: "layna2@member.local", phone: "7985464378", address: "53 Selston Road Birmingham, West Midlands", postcode: "B6 5HX", emergencyName: "Waseem Abbas", emergencyPhone: "07516047064" },
  { email: "layna1@member.local", phone: "7985464378", address: "53 Selston Road Birmingham, West Midlands", postcode: "B6 5HX", emergencyName: "Waseem Abbas", emergencyPhone: "07516047064" },
  { email: "rahil20042016@gmail.com", phone: "7883729300", address: "55 Moat House Rd Birmingham, West Midlands", postcode: "B8 3NP", emergencyName: "Zahid", emergencyPhone: "07550 688883" },
  { email: "faisalrazi@live.co.uk", phone: "7586554627", address: "91 Colesbourne Road Solihull, West Midlands", postcode: "B92 8LF", emergencyName: "Faisal Razi Hafiz", emergencyPhone: "07586554627" },
  { email: "hafizimran19@gmail.com", phone: "7497564804", address: "135 Tynedale Road Birmingham, West Midlands", postcode: "B11 3QY", emergencyName: "Hafiz Imran", emergencyPhone: "07497564804" },
  { email: "maliha465@outlook.com", phone: "7847261190", address: "22 Adria Road Birmingham, England", postcode: "B11 4JN", emergencyName: "Shazad Safdar", emergencyPhone: "07446 000081" },
  { email: "awais.ali9693@icloud.com", phone: "7563899187", address: "95 Leominster Road Birmingham, England", postcode: "B11 3BH", emergencyName: "Abid Ali", emergencyPhone: "07866 007860" },
  { email: "Imtiali99@gmail.com", phone: "7867860634", address: "407 Streetsbrook Road Solihull, West Midlands", postcode: "B91 1RF", emergencyName: "Zubaida Begum", emergencyPhone: "07570979061" },
  { email: "etphotography98@gmail.com", phone: "7739898827", address: "21 Wroxton Road Yardley Birmingham, West Midlands", postcode: "B26 1SH", emergencyName: "Sharon Thompson", emergencyPhone: "07739898827" },
  { email: "muhammedhasan483@gmail.com", phone: "7304083615", address: "58 Smirrells Road Birmingham, West Midlands", postcode: "B28 0LB", emergencyName: "Zulfiqar", emergencyPhone: "07989675392" },
  { email: "imy9985@gmail.com", phone: "7415404083", address: "634 Fox Hollies Road Birmingham", postcode: "B28 9DN", emergencyName: "Imran", emergencyPhone: "07415404083" },
  { email: "zahrabukhari88@gmail.com", phone: "7949789999", address: "344 Baldwins Lane Birmingham, West Midlands", postcode: "B28 0RD", emergencyName: "Zahra Bukhari", emergencyPhone: "07949789999" },
  { email: "nadim8027@outlook.com", phone: "7826305913", address: "188 Baldwins Lane Birmingham, Hall Green", postcode: "B28 0QA", emergencyName: "Nadim Hussain", emergencyPhone: "07826305913" },
  { email: "aqsarameez786@gmail.com", phone: "7557479520", address: "90 Robin Hood Lane Hall Green Birmingham, West Midlands", postcode: "B28 0JX", emergencyName: "Faiza Kousar", emergencyPhone: "07557479520" },
  { email: "m.aayan24@icloud.com", phone: "7459241170", address: "68 Finch Road Birmingham, England", postcode: "B19 1HR", emergencyName: "Aliza Tariq", emergencyPhone: "07308734733" },
  { email: "haarissyed3@gmail.com", phone: "7915027445", address: "17 Capcroft Rd Billesley Birmingham, West Midlands", postcode: "B13 0JB", emergencyName: "Mussarat", emergencyPhone: "07773235845" },
  { email: "riyadcfc@gmail.com", phone: "7742084683", address: "404 Wake Green Rd Birmingham, England", postcode: "B13 0BL", emergencyName: "Rob Abdulla", emergencyPhone: "07850 576749" },
  { email: "raja_rohail@hotmail.co.uk", phone: "7377454214", address: "298 Burbury Street Lozells Birmingham, West Midlands", postcode: "B19 1TP", emergencyName: "Omar Hayat", emergencyPhone: "07877729617" },
  { email: "asmattariq993@gmail.com", phone: "7737766486", address: "26 Francis Road Birmingham, West Midlands", postcode: "B25 8HP", emergencyName: "Toheed Tariq", emergencyPhone: "07400972727" },
  { email: "faraazmalik@outlook.com", phone: "7360654429", address: "22 Dunsmore Road Birmingham, England", postcode: "B28 8EB", emergencyName: "Arooj Abbasi", emergencyPhone: "07581154762" },
  { email: "salmahussaon1995@yahoo.com", phone: "7932016601", address: "85 Studland Road Hall Green Birmingham, West Midlands", postcode: "B28 8NP", emergencyName: "Salma Hussain", emergencyPhone: "07932016601" },
  { email: "zaheer.iqbal@zitex.co.uk", phone: "7863811470", address: "33 Barn Lane Moseley Birmingham, England", postcode: "B13 0SN", emergencyName: "Zaheer Iqbal", emergencyPhone: "07863811470" },
  { email: "akhtarnazreen27@gmail.com", phone: "7368815371", address: "203 Olton Boulevard East Birmingham, West Midlands", postcode: "B27 7BH", emergencyName: "Hasnain", emergencyPhone: "07450625924" },
  { email: "zednawaz1@outlook.com", phone: "7460407802", address: "43 Alum Drive Birmingham", postcode: "B9 5PF", emergencyName: "Dad", emergencyPhone: "07460407802" },
  { email: "saimakanwal2@hotmail.com", phone: "7515507634", address: "88 Runnymede Road Birmingham, West Midlands", postcode: "B11 3BW", emergencyName: "Saima Kanwal", emergencyPhone: "07515507634" },
  { email: "yusufa43211@outlook.com", phone: "7397564124", address: "72 Herbert Road Small Heath Birmingham", postcode: "B10 0PJ", emergencyName: "Sushna Bini", emergencyPhone: "07506 278542" },
  { email: "qummerabass@hotmail.com", phone: "7772280036", address: "29 Roderick Road Sparkhill Birmingham, West Midlands", postcode: "B11 1UE", emergencyName: "Qummer Abass", emergencyPhone: "07772280036" },
  { email: "sheryarnawaz771@gmail.com", phone: "7387822835", address: "252 Formans Road Birmingham", postcode: "B11 3BY", emergencyName: "Sheryar", emergencyPhone: "07387822835" },
  { email: "solemanali357@gmail.com", phone: "7397093409", address: "223 Bromford Road Birmingham, West Midlands", postcode: "B36 8HA", emergencyName: "Nafissa Rajraji", emergencyPhone: "07862 268301" },
  { email: "q_aashi@yahoo.com", phone: "7772509332", address: "25 Radstock Avenue Hodgehill Birmingham, West Midlands", postcode: "B36 8HE", emergencyName: "Azam Shafa", emergencyPhone: "07772509332" },
  { email: "shafiq28@outlook.com", phone: "7773522869", address: "28 Showell Green Lane Birmingham, West Midlands", postcode: "B11 4JP", emergencyName: "Mohammed Hasnaine", emergencyPhone: "07804973719" },
  { email: "child.aftab@member.local", phone: "7816582928", address: "67 Fernhurst Road Birmingham, West Midlands", postcode: "B8 3EG", emergencyName: "Zarqa Hussain", emergencyPhone: "07890532015" },
  { email: "aftabhussain@me.com", phone: "7816582928", address: "67 Fernhurst Road Birmingham, West Midlands", postcode: "B8 3EG", emergencyName: "Zarqa Hussain", emergencyPhone: "07890532015" },
  { email: "amar.shafiq75@gmail.com", phone: "7877100950", address: "40 Starbank Road Small Heath Birmingham, West Midlands", postcode: "B10 9LP", emergencyName: "Muhammad Amar Shafiq", emergencyPhone: "07877100950" },
]

async function updateUsers() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('   📝 UPDATING USER DETAILS IN PRODUCTION')
  console.log('═══════════════════════════════════════════════════════════════\n')

  let updated = 0
  let notFound = 0
  let errors = 0

  for (const userData of usersToUpdate) {
    try {
      // Find user by email (case insensitive)
      const user = await prisma.user.findFirst({
        where: { 
          email: { equals: userData.email, mode: 'insensitive' }
        }
      })

      if (!user) {
        console.log(`⚠️  Not found: ${userData.email}`)
        notFound++
        continue
      }

      // Build emergency contact JSON
      const emergencyContact = JSON.stringify({
        name: userData.emergencyName,
        phone: userData.emergencyPhone,
        relationship: '',
        addressInfo: {
          address: userData.address,
          postcode: userData.postcode
        }
      })

      // Format phone with leading 0 if needed
      let phone = userData.phone
      if (phone && !phone.startsWith('0') && !phone.startsWith('+')) {
        phone = '0' + phone
      }

      // Update the user
      await prisma.user.update({
        where: { id: user.id },
        data: {
          phone: phone,
          emergencyContact: emergencyContact
        }
      })

      console.log(`✅ Updated: ${user.firstName} ${user.lastName} (${userData.email})`)
      updated++

    } catch (err: any) {
      console.log(`❌ Error for ${userData.email}: ${err.message}`)
      errors++
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('   COMPLETE')
  console.log('═══════════════════════════════════════════════════════════════\n')
  
  console.log(`✅ Updated:   ${updated}`)
  console.log(`⚠️  Not found: ${notFound}`)
  console.log(`❌ Errors:    ${errors}`)

  await prisma.$disconnect()
}

updateUsers().catch(console.error)


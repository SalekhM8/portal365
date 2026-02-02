import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Members data from the list
const membersData = [
  { name: "Burhan Younas", email: "traceyeoin923@gmail.com", phone: "", address: "", emergency: "" },
  { name: "Burhan Younas", email: "younasb.enquiries@gmail.com", phone: "", address: "", emergency: "" },
  { name: "Hameed Ahmad", email: "hameedahmad2121@gmail.com", phone: "7456403799", address: "51 Caldwell road 51 Birmingham, West Midlands, B9 5TW, GB", emergency: "Shazia / 07766082924" },
  { name: "Ibraheem Younis", email: "tahir.younis@consultant.com", phone: "7952911145", address: "23 Belle Walk Birmingham, England, B13 9DE, GB", emergency: "Tahir younis / 07952911145" },
  { name: "Farooq Hussain", email: "infodairykingcart@gmail.com", phone: "7826797185", address: "51 imperial rd Birmingham, Westmidlands, B95HB, GB", emergency: "Akhtar Hussain / 07970333617" },
  { name: "Muhammed Awan", email: "cus_SnMcxPJYUmCSXw@member.local", phone: "7932028658", address: "6 Hollyhurst Grove Yardley Birmingham, Westmidland, B261AR, GB", emergency: "Ash / 07932028658" },
  { name: "Wahhab Ali", email: "arbabali83@hotmail.com", phone: "7875457911", address: "87 Russell Road, Birmingham, UK Hall Green Birmingham, Westmidlands, B28 8SG, GB", emergency: "Father / 07875457911" },
  { name: "Mikaeel Zaheer", email: "mickyzaheer@gmail.com", phone: "7496460928", address: "38 Francis road Birmingham, West midlands, B25 8HP, GB", emergency: "Mehnaz / 07735 419593" },
  { name: "Asfand Khan", email: "asfandkhanyar1997@gmail.com", phone: "7851430806", address: "286 Wake Green Rd Birmingham, West Midlands, B13 9qp, GB", emergency: "Ibrahim Khan / 07709 094900" },
  { name: "Mohammed Shayan Raja", email: "rbmahmood@yahoo.co.uk", phone: "7816919764", address: "8th fanshawe road Birmingham, England, B27 7Bu, GB", emergency: "Raja Mahmood / 7816919764" },
  { name: "Ibrahim Haider", email: "ibrahimHaiider@gmail.com", phone: "7840224826", address: "FLAVELLS LANE BIRMINGHAM, Birmingham, B25 8SQ, GB", emergency: "Aqib / 07958308569" },
  { name: "Fatir Islam", email: "elly.islam@gmail.com", phone: "7448309293", address: "93 Bushmore Road Birmingham, England, B28 9QY, GB", emergency: "Islam MD Tajul / 07505914019" },
  { name: "Muhammad1 Aayan", email: "child.wasim29@member.local", phone: "7875300915", address: "134 Swanshurst lane Moseley Birmingham, West midland, B130am, GB", emergency: "Adil Hussain / 07502394097" },
  { name: "Muhammad Hashim", email: "wasim29@live.co.uk", phone: "7875300915", address: "134 Swanshurst lane Moseley Birmingham, West Midlands, B130an, GB", emergency: "07853 401014" },
  { name: "Rayyah Ali", email: "alamin.ali@gmail.com", phone: "7428337511", address: "37 Edenbridge Rd Hall green Birmingham, West Midlands, B28 8PS, GB", emergency: "07428337511/Alamin" },
  { name: "Faisal Ahsan", email: "faisalahsan_786@hotmail.com", phone: "7494560687", address: "57 Brookhill Road Ward End Birmingham, England, B8 3PA, GB", emergency: "Sehrish / 07487526536" },
  { name: "Aisha Mohamed", email: "aishm1667@gmail.com", phone: "7867233660", address: "214 Somerville Road Birmingham, West Midlands, B10 9HB, GB", emergency: "Hawa Aweys Ahmed / 07482737147" },
  { name: "Mariyah Ahmed", email: "samia.hussain@live.co.uk", phone: "7965314694", address: "186 Sunnymead Road BIRMINGHAM, West Midlands, B26 1LS, GB", emergency: "Samia Hussain/07965314694" },
  { name: "Zainab Fatima", email: "child.nabila@member.local", phone: "7864684382", address: "15 Treaford lane Birmingham, Ward end, B8 2uf, GB", emergency: "7864684382" },
  { name: "Safiyyah Khan", email: "child.mehnaz@member.local", phone: "7771399732", address: "36 Painswick Road Hall Green Birmingham, West Midlands, B28 0HF, GB", emergency: "Sahdat Khan/07872628096" },
  { name: "Hafsa Khan", email: "mehnaz273@googlemail.com", phone: "7771399732", address: "36 Painswick Road Hall Green Birmingham, West Midlands, B28 0HF, GB", emergency: "Sahdat Khan/07872628096" },
  { name: "Amina Zahra", email: "nabila_mustafa@hotmail.co.uk", phone: "7864684382", address: "15 Treaford lane Birmingham, Wardend, B8 2uf, GB", emergency: "7864684382" },
  { name: "Adil Abbasi", email: "abbasi_adil@hotmail.com", phone: "7813875745", address: "216 Barrows Lane Birmingham, West Midlands, B26 1rn, GB", emergency: "Adil Abbasi/07813875745" },
  { name: "Yusuf Tahir", email: "ytahir321@gmail.com", phone: "7716433050", address: "22 Tyndale road Birmingham, West Midlands, B11 3QP, GB", emergency: "Isma akhtar/07367482227" },
  { name: "Muhammad Tazhutdinov", email: "tshnram@gmail.com", phone: "7588110808", address: "14 The Crescent Shirley SOLIHULL, West Midlands, B90 2ES, GB", emergency: "Ramazan/07887012590" },
  { name: "Hassan Khan", email: "hassan.mahammed.khan@gmail.com", phone: "7756392464", address: "37 Geranium Grove Birmingham, West midlands, B9 5hq, GB", emergency: "Bibi Maskin/07400577588" },
  { name: "Ikhlaas Ahmed", email: "ikhlaas.ahmed@icloud.com", phone: "7899841115", address: "1 Farquhar Road Edgbaston Birmingham, West Midlands, B15 3RA, GB", emergency: "Suhail Ahmed/+44 7929 341945" },
  { name: "Arman Shiraz", email: "armanshiraz9@gmail.com", phone: "7488333206", address: "185 Pretoria Road Birmingham, West Midlands, B95LN, GB", emergency: "Shiraz Ahmed/07847471247" },
  { name: "MUHAMMAD BUTT", email: "butt48560@icloud.com", phone: "7508916055", address: "51 Hollyhock Road Birmingham, Islam, B27 7SU, GB", emergency: "Iftikhar/07791275333" },
  { name: "Mohammed-Aman Yaqoob", email: "shakyaqoob@gmail.com", phone: "7581118888", address: "43 Northanger Road Acocks Green Birmingham, West Midlands, B27 7RG, GB", emergency: "07581118888/Shak" },
  { name: "Abdul Rehman", email: "arehman871@hotmail.com", phone: "7426894084", address: "58 hob moor road Birmingham, West Midlands, B10 9BU, GB", emergency: "Masher/07754801039" },
  { name: "Nahim Rahman", email: "mohammednahimrahman@outlook.com", phone: "07493 113368", address: "46 The Ring Birmingham, Yardley, B25 8QA, GB", emergency: "Fatima Begum/07858 869851" },
  { name: "Hamza Mahmood", email: "hamzamahmood747@icloud.com", phone: "7565331245", address: "79 Fosbrooke road Birmingham, West midlands, B10 9JY, GB", emergency: "Tahir/07853 190237" },
  { name: "Jameil Samuda", email: "jameilsamuda@gmail.com", phone: "7377449878", address: "45 grange road Birmingham, West Midlands, B14 7RN, GB", emergency: "Ben/07454790701" },
  { name: "Francesco Brasoveanu", email: "r6.cobran@gmail.com", phone: "7493092182", address: "31 Hazelville Road Birmingham, England, B28 9PY, GB", emergency: "Alin Stanciu/+44 7871 796927" },
  { name: "Abdullah Farooq", email: "nfarooq-child@member.local", phone: "7445411957", address: "4 barnford close Small heath Birmingham, West Midlands, B10 0BL, GB", emergency: "Haneef ahmed/07528377733" },
  { name: "Dawud Kashif", email: "sahdia_rasool@hotmail.com", phone: "7867388105", address: "42 Epwell Road Kingstanding Road Birmingham, West Midlands, B44 8dd, GB", emergency: "Kashif Mahmood/07861115991" },
  { name: "Ismaeel Farooq", email: "Nfarooq1328@hotmail.co.uk", phone: "7445411957", address: "4 barnford close Small Heath Birmingham, West midlands, B10 0BL, GB", emergency: "Haneef ahmed/07528377733" },
  { name: "Huzaifa Din", email: "qasim_din@hotmail.co.uk", phone: "7935182325", address: "454 walsall rd Birmingham, West Midlands, B42 2lu, GB", emergency: "Mariam hussain/07508885894" },
  { name: "Dawud Akhtar", email: "aazadakhtar@icloud.com", phone: "7446762230", address: "70 Loeless road Birmingham, West midlands, B33 9Rh, GB", emergency: "azad/074467672230" },
  { name: "Hajar Abduljalil", email: "jay@afjltd.co.uk", phone: "7973626886", address: "79 golden hillock road small heath birmingham, west midlands, B10 0JU, GB", emergency: "Abdul Jalil/07973626886" },
  { name: "Mubashir Ali", email: "mubashirali0246@gmail.com", phone: "7828709800", address: "38 Lyncroft Road Birmingham, West Midlands, B113eh, GB", emergency: "Ali Asghar/07427532608" },
  { name: "Omar Suleiman", email: "Omarsuleiman2483@gmail.com", phone: "7748129360", address: "9 poppy place Birmingham, West midlands, B90 2FF, GB", emergency: "Alina/07539132753" },
  { name: "Adam Haroon", email: "adamharoon@hotmail.co.uk", phone: "7582600900", address: "20 Hornbrook Grove Solihull, West Midlands, B92 7HH, GB", emergency: "Haroon Rashid/07967319108" },
  { name: "Sijan Nazrul", email: "nazrul_03@outlook.com", phone: "7849226943", address: "275 Shaftmoor Lane Birmingham, United Kingdom, B28 8SL, GB", emergency: "Noorjahan Begum/07903093684" },
  { name: "Liyana Abbas", email: "layna2@member.local", phone: "7985464378", address: "53 Selston Road Birmingham, West Midlands, B6 5hx, GB", emergency: "Waseem Abbas/07516047064" },
  { name: "Lamisa Abbas", email: "layna1@member.local", phone: "7985464378", address: "53 Selston Road Birmingham, West Midlands, B6 5HX, GB", emergency: "Waseem Abbas/07516047064" },
  { name: "Rahil Hussain", email: "rahil20042016@gmail.com", phone: "7883729300", address: "55 moat house rd Birmingham, West Midlands, B8 3NP, GB", emergency: "Zahid/07550 688883" },
  { name: "Liyana Emaan Razi", email: "faisalrazi@live.co.uk", phone: "7586554627", address: "91 COLESBOURNE ROAD SOLIHULL, West Midlands, B92 8LF, GB", emergency: "FAISAL RAZI HAFIZ/07586554627" },
  { name: "Khadijah Amin", email: "hafizimran19@gmail.com", phone: "7497564804", address: "135, Tynedale Road, Birmingham, B11 3QY Birmingham, West Midlands, B11 3QY, GB", emergency: "Hafiz Imran/07497564804" },
  { name: "Maliha Shazad", email: "maliha465@outlook.com", phone: "7847261190", address: "22 Adria Road Birmingham, England, B11 4JN, GB", emergency: "Shazad Safdar/07446 000081" },
  { name: "Awais Ali", email: "awais.ali9693@icloud.com", phone: "7563899187", address: "95 Leominster Road Birmingham, England, B11 3BH, GB", emergency: "Abid ali/07866 007860" },
  { name: "Noor-Amina Ali", email: "Imtiali99@gmail.com", phone: "7867860634", address: "407 Streetsbrook Road Solihull, West Midlands, B91 1RF, GB", emergency: "Zubaida Begum/07570979061" },
  { name: "Elijah Wilson - Thompson", email: "etphotography98@gmail.com", phone: "7739898827", address: "21 Wroxton Road Yardley Birmingham, West Midlands, B26 1SH, GB", emergency: "Sharon thompson/07739898827" },
  { name: "Muhammad Hasan", email: "muhammedhasan483@gmail.com", phone: "7304083615", address: "58 Smirrells Road Birmingham, West Midlands, B28 0LB, GB", emergency: "Zulfiqar/07989675392" },
  { name: "Muhammed Haris", email: "imy9985@gmail.com", phone: "7415404083", address: "634 fox hollies road Birmingham, Birmingham, B289dn, GB", emergency: "Imran/07415404083" },
  { name: "Syed Muhammad Yusuf Ali", email: "zahrabukhari88@gmail.com", phone: "7949789999", address: "344 Baldwins Lane Birmingham, West Midlands, B280RD, GB", emergency: "Zahra Bukhari/07949789999" },
  { name: "Ibrahim Nadim", email: "nadim8027@outlook.com", phone: "7826305913", address: "188 baldwins Lane Birmingham, Hall Green, B28 0QA, GB", emergency: "Nadim Hussain/07826305913" },
  { name: "Musa Ramiz", email: "aqsarameez786@gmail.com", phone: "7557479520", address: "90 Robin Hood Lane Hall Green Birmingham, West Midlands, B28 0JX, GB", emergency: "Faiza kousar/07557479520" },
  { name: "Muhammad Aayan", email: "m.aayan24@icloud.com", phone: "7459241170", address: "68 Finch Road Birmingham, England, B19 1HR, GB", emergency: "Aliza tariq/0730873473" },
  { name: "Haaris Syed", email: "haarissyed3@gmail.com", phone: "7915027445", address: "17 Capcroft Rd. Billesley Birmingham, West Midlands, B13 0JB, GB", emergency: "Mussarat/07773235845" },
  { name: "Riyad Abdulla", email: "riyadcfc@gmail.com", phone: "7742084683", address: "404 Wake Green Rd Birmingham, England, B13 0BL, GB", emergency: "Rob Abdulla/ 07850 576749" },
  { name: "Rohail Ishfaq", email: "raja_rohail@hotmail.co.uk", phone: "7377454214", address: "298 burbury street lozells Birmingham, West Midlands, B19 1tp, GB", emergency: "Omar Hayat/ 07877729617" },
  { name: "Mohammed Hamaadullah Tariq", email: "asmattariq993@gmail.com", phone: "7737766486", address: "26 Francis Road Birmingham, West Midlands, B25 8HP, GB", emergency: "Toheed Tariq/07400972727" },
  { name: "Faraaz Malik", email: "faraazmalik@outlook.com", phone: "7360654429", address: "22 Dunsmore Road Birmingham, England, B28 8EB, GB", emergency: "Arooj Abbasi/07581154762" },
  { name: "Maysoon Chowdhury", email: "salmahussaon1995@yahoo.com", phone: "7932016601", address: "85 Studland Road Hall Green Birmingham, West Midlands, B28 8np, GB", emergency: "Salma Hussain/07932016601" },
  { name: "Aleemah Iqbal", email: "zaheer.iqbal@zitex.co.uk", phone: "7863811470", address: "33 Barn Lane, Moseley Moseley Birmingham, England, B13 0sn, GB", emergency: "Zaheer iqbal/07863811470" },
  { name: "Ismail Khan", email: "akhtarnazreen27@gmail.com", phone: "7368815371", address: "203 Olton Boulevard East Birmingham, West Midlands, B27 7BH, GB", emergency: "Hasnain/07450625924" },
  { name: "Muzahir Nawaz", email: "zednawaz1@outlook.com", phone: "7460407802", address: "43 alum drive Birmingham, Uk, B9 5 pf, GB", emergency: "Dad / 07460407802" },
  { name: "Safa Noor", email: "saimakanwal2@hotmail.com", phone: "7515507634", address: "88 Runnymede Road Birmingham, West Midlands, B11 3BW, GB", emergency: "Saima Kanwal/07515507634" },
  { name: "Yusuf Abdullah", email: "yusufa43211@outlook.com", phone: "7397564124", address: "72 Herbert Road, Small Heath Birmingham, County (optional), B100PJ, GB", emergency: "Sushna Bini/07506 278542" },
  { name: "Abdurraheem Abass", email: "qummerabass@hotmail.com", phone: "7772280036", address: "29 Roderick road Sparkhill Birmingham, West midlands, B111ue, GB", emergency: "Qummer Abass/07772280036" },
  { name: "Sheryar Nawaz", email: "sheryarnawaz771@gmail.com", phone: "447387822835", address: "252 formans road b113by Birmingham, Uk, b113by, GB", emergency: "Sheryar/ 07387822835" },
  { name: "Soleman Ali", email: "solemanali357@gmail.com", phone: "7397093409", address: "223 bromford road Birmingham, West Midlands, B36 8ha, GB", emergency: "Nafissa rajraji/07862 268301" },
  { name: "Ayaan Azam", email: "q_aashi@yahoo.com", phone: "7772509332", address: "25 Radstock Avenue Hodgehill Birmingham, West Midlands, B36 8HE, GB", emergency: "Azam Shafa/07772509332" },
  { name: "Mohammed UWAIS Shafiq", email: "shafiq28@outlook.com", phone: "7773522869", address: "28 Showell Green Lane Birmingham, West Midlands, B11 4JP, GB", emergency: "Mohammed hasnaine/07804973719" },
  { name: "Abu-Bakr Ibn Aftab", email: "child.aftab@member.local", phone: "7816582928", address: "67 Fernhurst Road Birmingham, West Midlands, B8 3EG, GB", emergency: "Zarqa Hussain/07890532015" },
  { name: "Umar Ibn Aftab", email: "aftabhussain@me.com", phone: "7816582928", address: "67 Fernhurst Road Birmingham, West Midlands, B8 3EG, GB", emergency: "Zarqa Hussain/07890532015" },
  { name: "Muzamil amar Shafiq", email: "amar.shafiq75@gmail.com", phone: "7877100950", address: "40 starbank road Small heath Birmingham, West midlands, B10 9LP, GB", emergency: "Muhammad Amar Shafiq/07877100950" },
  { name: "Adnan Ahmed", email: "adnanahmed98@hotmail.com", phone: "7946963830", address: "53 Somerville road Birmingham, West Midlands, B109en, GB", emergency: "Ashfaq Ahmed/07588704308" },
  { name: "Isaaq Suhaib", email: "ahmedsuhaib925@gmail.com", phone: "7412501274", address: "76 kenelm road Birmingham, West Midlands, B10 9aj, GB", emergency: "Suhaib/07412501274" },
  { name: "Safah Ellahi", email: "safahellahi11@icloud.com", phone: "7772372099", address: "37 allcroft road Birmingham, Tysley, B113EE, PK", emergency: "Imran Ellahi / 07772372099" },
  { name: "Luhayyah Hussain", email: "goaway121@hotmail.com", phone: "7538358031", address: "107 fallowfield rd Solihull, West mids, B92 9HQ, GB", emergency: "Amar Hussain/07538358031" },
  { name: "Nusaybah Isaan", email: "mrisaanraza@gmail.com", phone: "7838380909", address: "22 homecroft rd Birmingham, West Midlands, b25 8xn, GB", emergency: "isaan/07838380909" },
  { name: "Sumayyah Isaan", email: "mrisaanraza@gmail.com", phone: "7838380909", address: "22 Homecroft Road Birmingham, West Midlands, B25 8XN, GB", emergency: "isaan/07838380909" },
  { name: "Mohammed Khan", email: "mohkhane37@gmail.com", phone: "7954055261", address: "137 Fox Hollies Road Birmingham, West Midlands, B277TZ, GB", emergency: "daud Khan/07730751318" },
  { name: "Rehaan Nadim", email: "nadim8027@outlook.com", phone: "7826305913", address: "188 baldwins Lane Birmingham, Hall Green, B28 0QA, GB", emergency: "Nadim Hussain/07826305913" },
  { name: "Faiza Nourain", email: "faizanourain@gmail.com", phone: "7958189640", address: "101 pierce avenue Solihull, West Midlands, B92 7JY, GB", emergency: "Fozia Kousar/07487704469" },
  { name: "Musa Sheraz", email: "msheraz1996@gmail.com", phone: "7481305231", address: "39 fastpits Rd Yardley Birmingham, West Midlands, B25 8PB, GB", emergency: "Mohammed sheraz/07481305231" },
  { name: "Muhammad Hassan Taj", email: "mzt365@hotmail.com", phone: "7803267086", address: "108 bowyer rd Birmingham, West Midlands, B8 1ES, GB", emergency: "Zafran/07803267086" },
  { name: "Muhammad Hammaad Taj", email: "mzt365@hotmail.com", phone: "7803267086", address: "108 bowyer rd Birmingham, West Midlands, B8 1ES, GB", emergency: "Zafran/07803267086" },
  { name: "Nasteha Hassan", email: "nastehah194@gmail.com", phone: "7931589946", address: "10 oliver street Birmingham, West midlands, B74NX, GB", emergency: "Layla Mohamud/07494636998" },
  { name: "Yusuf Kiani", email: "shazaadi82@gmail.com", phone: "7886579767", address: "49 Beechmore Road Sheldon Birmingham, West Midlands, B26 3AR, GB", emergency: "Atia/07886579767" },
]

// Build lookup by email (lowercase)
const membersByEmail: Record<string, typeof membersData[number]> = {}
for (const m of membersData) {
  membersByEmail[m.email.toLowerCase()] = m
}

async function main() {
  console.log('🔍 Finding users with missing details in prod...\n')

  // Find users with missing details
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { firstName: null },
        { firstName: '' },
        { lastName: null },
        { lastName: '' },
        { phone: null },
        { phone: '' },
        { address: null },
        { address: '' },
        { emergencyContact: null },
        { emergencyContact: '' },
      ]
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      address: true,
      emergencyContact: true,
    }
  })

  console.log(`Found ${users.length} users with missing details\n`)

  let updated = 0
  let notFound = 0
  const notFoundList: string[] = []

  for (const user of users) {
    const memberData = membersByEmail[user.email.toLowerCase()]
    
    if (!memberData) {
      notFound++
      notFoundList.push(user.email)
      continue
    }

    // Parse name
    const nameParts = memberData.name.trim().split(' ')
    const firstName = nameParts[0] || ''
    const lastName = nameParts.slice(1).join(' ') || ''

    // Build update data - only update fields that are missing
    const updateData: any = {}
    
    if (!user.firstName && firstName) updateData.firstName = firstName
    if (!user.lastName && lastName) updateData.lastName = lastName
    if (!user.phone && memberData.phone) updateData.phone = memberData.phone.replace(/\s/g, '')
    if (!user.address && memberData.address) updateData.address = memberData.address
    if (!user.emergencyContact && memberData.emergency) updateData.emergencyContact = memberData.emergency

    if (Object.keys(updateData).length > 0) {
      console.log(`✅ Updating ${user.email}:`, updateData)
      await prisma.user.update({
        where: { id: user.id },
        data: updateData
      })
      updated++
    }
  }

  console.log(`\n📊 Summary:`)
  console.log(`   Updated: ${updated} users`)
  console.log(`   Not in list: ${notFound} users`)
  
  if (notFoundList.length > 0) {
    console.log(`\n⚠️ Users not found in provided list:`)
    notFoundList.forEach(e => console.log(`   - ${e}`))
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())


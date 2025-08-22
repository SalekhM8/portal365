'use client'

import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Dumbbell, 
  Heart, 
  ArrowRight,
  Users,
  Star,
  CheckCircle2,
  Menu,
  X
} from "lucide-react";
import { MEMBERSHIP_PLANS } from "@/config/memberships";
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogTrigger,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

const businesses = [
  {
    id: 'aura_mma',
    name: 'Aura MMA',
    description: 'Premier martial arts training facility',
    icon: Dumbbell,
    color: 'bg-gradient-to-br from-red-500 to-red-600',
    offerings: ['World class grappling', 'Elite level striking coaching', 'Professional MMA fighters and coaches', 'National Champions Wrestling coach', 'World class Strength and Conditioning Facility'],
    membershipTypes: [
      { name: 'Full Access', price: MEMBERSHIP_PLANS.FULL_ADULT.monthlyPrice, popular: true, key: 'FULL_ADULT' },
      { name: 'Weekend Only', price: MEMBERSHIP_PLANS.WEEKEND_ADULT.monthlyPrice, popular: false, key: 'WEEKEND_ADULT' },
      { name: 'Kids Unlimited (Under 14s)', price: MEMBERSHIP_PLANS.KIDS_UNLIMITED_UNDER14.monthlyPrice, popular: false, key: 'KIDS_UNLIMITED_UNDER14' },
      { name: 'Kids Weekend (Under 14s)', price: MEMBERSHIP_PLANS.KIDS_WEEKEND_UNDER14.monthlyPrice, popular: false, key: 'KIDS_WEEKEND_UNDER14' },
      { name: 'Masters Program (30+)', price: MEMBERSHIP_PLANS.MASTERS.monthlyPrice, popular: false, key: 'MASTERS' }
    ]
  },
  {
    id: 'aura_womens',
    name: "Aura Women's Gym",
    description: 'Top calibre womens muay thai training',
    icon: Heart,
    color: 'bg-gradient-to-br from-pink-500 to-pink-600',
    offerings: ['Muay Thai Only', 'Women-Only Classes', 'Qualified Female Instructor', 'Technique-Focused Training'],
    membershipTypes: [
      { name: "Women's Program", price: MEMBERSHIP_PLANS.WOMENS_CLASSES.monthlyPrice, popular: true, key: 'WOMENS_CLASSES' }
    ]
  }
];

export default function Home() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [timetableOpen, setTimetableOpen] = useState(false);
  const [classes, setClasses] = useState<Array<any>>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);

  useEffect(() => {
    if (!timetableOpen || classes.length) return;
    setLoadingClasses(true);
    fetch('/api/classes')
      .then(r => r.json())
      .then(json => {
        if (json?.success && Array.isArray(json.classes) && json.classes.length > 0) {
          setClasses(json.classes);
        } else {
          setClasses(getFallbackTimetable());
        }
      })
      .finally(() => setLoadingClasses(false));
  }, [timetableOpen, classes.length]);

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Navigation - Mobile Optimized */}
      <nav className="border-b border-white/10 bg-black/95 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
                <span className="text-black font-bold text-sm">P</span>
              </div>
              <span className="text-xl font-bold text-white">Portal365</span>
            </div>
            
            {/* Desktop Navigation */}
            <div className="hidden sm:flex items-center gap-3">
              <Link href="/auth/signin">
                <Button variant="outline" size="sm" className="border-white/20 bg-transparent text-white hover:bg-white hover:text-black transition-all duration-300">
                  Customer Login
                </Button>
              </Link>
              <Link href="/auth/signin">
                <Button variant="outline" size="sm" className="border-white/20 bg-transparent text-white hover:bg-white hover:text-black transition-all duration-300">
                  Admin Login
                </Button>
              </Link>
            </div>

            {/* Mobile Menu Button */}
            <div className="sm:hidden">
              <Button 
                variant="ghost" 
                size="icon" 
                className="text-white hover:bg-white/10"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Menu className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
          
          {/* Mobile Navigation Menu - Collapsible */}
          {mobileMenuOpen && (
            <div className="sm:hidden pb-4 space-y-2 animate-in slide-in-from-top-2 duration-200">
              <Link href="/auth/signin" className="block" onClick={() => setMobileMenuOpen(false)}>
                <Button variant="outline" size="sm" className="w-full border-white/20 bg-transparent text-white hover:bg-white hover:text-black transition-all duration-300">
                  Customer Login
                </Button>
              </Link>
              <Link href="/auth/signin" className="block" onClick={() => setMobileMenuOpen(false)}>
                <Button variant="outline" size="sm" className="w-full border-white/20 bg-transparent text-white hover:bg-white hover:text-black transition-all duration-300">
                  Admin Login
                </Button>
              </Link>
            </div>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background Elements */}
        <div className="absolute inset-0">
          <div className="absolute top-20 left-10 w-72 h-72 bg-red-500/10 rounded-full blur-3xl"></div>
          <div className="absolute bottom-20 right-10 w-96 h-96 bg-pink-500/10 rounded-full blur-3xl"></div>
        </div>
        
        <div className="relative container mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center space-y-8">
          <Badge className="mx-auto bg-white/10 text-white border-white/20 hover:bg-white/20 transition-all duration-300">
            <Star className="h-3 w-3 mr-1" />
            Multi-Business Platform
          </Badge>
          
          <div className="space-y-6 max-w-4xl mx-auto">
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-tight">
              Welcome to <span className="bg-gradient-to-r from-red-500 to-red-700 bg-clip-text text-transparent">Aura MMA</span>
            </h1>
            <p className="text-lg sm:text-xl text-white/70 max-w-2xl mx-auto leading-relaxed">
              A collaboration by friends to spread the martial arts lifestyle in the community
            </p>
          </div>

          {/* Aura Logo */}
          <div className="pt-8 pb-4">
            <div className="flex justify-center">
              <div className="relative p-8 rounded-2xl bg-gradient-to-br from-white/15 via-white/10 to-white/5 backdrop-blur-sm border border-white/10 shadow-2xl">
                {/* Subtle inner glow effect */}
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent"></div>
                <div className="relative">
                  <Image
                    src="/images/auralogo.png"
                    alt="Aura MMA Logo"
                    width={200}
                    height={200}
                    className="w-48 h-48 sm:w-56 sm:h-56 md:w-64 md:h-64 object-contain drop-shadow-xl"
                    priority
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Tagline */}
          <div className="pt-4">
            <p className="text-base sm:text-lg font-medium text-white/90">
              One of the UK's top martial arts facilities
            </p>
          </div>

          {/* View Timetable Button */}
          <div className="pt-2">
            <AlertDialog open={timetableOpen} onOpenChange={setTimetableOpen}>
              <AlertDialogTrigger asChild>
                <Button className="bg-red-600 hover:bg-red-700 text-white px-6 py-6 rounded-xl font-semibold shadow-lg shadow-red-900/20">
                  View Timetable
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-black/90 text-white border-white/10 max-w-6xl">
                <AlertDialogHeader>
                  <div className="flex items-center justify-between">
                    <AlertDialogTitle>Class Timetable</AlertDialogTitle>
                    <AlertDialogCancel className="border-white/20 text-white hover:bg-white/10">Close</AlertDialogCancel>
                  </div>
                  <AlertDialogDescription className="text-white/70">
                    Drop-in classes available with your membership. No booking required.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="max-h-[75vh] overflow-y-auto pr-1">
                  {loadingClasses ? (
                    <div className="py-10 text-center text-white/70">Loading timetable…</div>
                  ) : (
                    <TimetableGrid classes={classes} />
                  )}
                </div>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </section>

      {/* Business Selection */}
      <section className="relative py-16 sm:py-24">
        <div className="container mx-auto px-4 sm:px-6 space-y-12">
          <div className="text-center space-y-6">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-tight">
              Choose Your <span className="bg-gradient-to-r from-red-500 to-red-700 bg-clip-text text-transparent">Combat Journey</span>
            </h2>
            <p className="text-lg sm:text-xl text-white/70 max-w-3xl mx-auto leading-relaxed">
              Each membership plan is designed to bring you closer to your combat sport goals
            </p>
          </div>

          <div className="grid gap-8 lg:grid-cols-2 max-w-6xl mx-auto">
            {businesses.map((business) => {
              const IconComponent = business.icon;
              return (
                <Card key={business.id} className="bg-white/5 border-white/10 backdrop-blur-sm">
                  <CardHeader className="space-y-6 p-6 sm:p-8">
                    <div className="flex items-start gap-4">
                      <div className={`p-4 rounded-xl ${business.color} text-white shadow-lg`}>
                        <IconComponent className="h-7 w-7" />
                      </div>
                      <div className="flex-1">
                        <CardTitle className="text-xl sm:text-2xl text-white font-bold mb-2">{business.name}</CardTitle>
                        <CardDescription className="text-base text-white/70">
                          {business.description}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                
                  <CardContent className="space-y-8 p-6 sm:p-8 pt-0">
                    {/* Offerings */}
                    <div className="space-y-4">
                      <h4 className="font-semibold text-white/90 text-sm uppercase tracking-wider">What's Included:</h4>
                      <div className="grid gap-3">
                        {business.offerings.map((offering, index) => (
                          <div key={index} className="flex items-start gap-3 text-sm text-white/80">
                            <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0 mt-0.5" />
                            <span className="leading-relaxed">{offering}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Membership Options */}
                    <div className="space-y-4">
                      <h4 className="font-semibold text-white/90 text-sm uppercase tracking-wider">Membership Options:</h4>
                      <div className="space-y-3">
                        {business.membershipTypes.map((membership, index) => (
                          <Link key={index} href={`/register/details?business=${business.id}&plan=${membership.key}`}>
                            <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 cursor-pointer group">
                              <span className="flex items-center gap-2 text-white">
                                {membership.name}
                                {membership.popular && (
                                  <Badge className="bg-gradient-to-r from-red-500 to-pink-500 text-white text-xs border-0">Popular</Badge>
                                )}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-white">£{membership.price}<span className="text-sm text-white/60">/mo</span></span>
                                <ArrowRight className="h-4 w-4 text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all duration-300" />
                              </div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>

                    {/* CTA Button - Fallback for users who want to see all options */}
                    <Link href={`/register?business=${business.id}`}>
                      <Button className="w-full bg-white text-black hover:bg-white/90 font-semibold text-base py-6 rounded-xl transition-all duration-300 hover:shadow-lg hover:shadow-white/20">
                        View All {business.name} Options
                        <ArrowRight className="h-5 w-5 ml-2 hover:translate-x-1 transition-transform duration-300" />
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="text-center pt-12">
            <p className="text-white/70 mb-6 text-base">
              Not sure which business is right for you?
            </p>
            <Button variant="outline" size="lg" className="border-white/20 bg-transparent text-white hover:bg-white hover:text-black transition-all duration-300 px-8">
              Compare All Options
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 bg-black/50 backdrop-blur-md">
        <div className="container mx-auto px-4 sm:px-6 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 bg-white rounded flex items-center justify-center">
                <span className="text-black font-bold text-xs">P</span>
              </div>
              <span className="font-semibold text-white">Portal365</span>
            </div>
            <div className="text-sm text-white/60">
              Multi-business fitness platform
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function getDayName(dayOfWeek: number): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[dayOfWeek] || 'Unknown';
}

function TimetableGrid({ classes }: { classes: any[] }) {
  const days = [1,2,3,4,5,6,0]; // Mon..Sun
  const byDay = days.map(d => ({
    day: d,
    label: fullDayName(d),
    items: classes
      .filter(c => c.dayOfWeek === d)
      .sort((a,b) => a.startTime.localeCompare(b.startTime))
  }))

  return (
    <div className="md:grid md:gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
      {/* Mobile: horizontal scroll columns with snap */}
      <div className="md:hidden overflow-x-auto -mx-2 px-2 snap-x snap-mandatory flex gap-3">
        {byDay.map(col => (
          <DayColumn key={col.day} label={col.label} items={col.items} className="min-w-[74%] snap-start" />
        ))}
      </div>

      {/* Desktop grid */}
      <div className="hidden md:contents">
        {byDay.map(col => (
          <DayColumn key={col.day} label={col.label} items={col.items} />
        ))}
      </div>

      <LegendBar />
    </div>
  )
}

function DayColumn({ label, items, className }: { label: string; items: any[]; className?: string }) {
  return (
    <div className={`border border-white/10 rounded-xl bg-white/5 overflow-hidden ${className || ''}`}>
      <div className="bg-red-600 text-white px-3 py-2 font-semibold text-sm sticky top-0 z-10">{label}</div>
      <div className="divide-y divide-white/10">
        {items.length === 0 ? (
          <div className="p-4 text-sm text-white/60">No classes</div>
        ) : (
          items.map((c: any) => <ClassCard key={c.id} c={c} />)
        )}
      </div>
    </div>
  )
}

function ClassCard({ c }: { c: any }) {
  const tags = parseTags(c);
  return (
    <div className="p-3 hover:bg-white/10 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium leading-tight truncate">{c.name}</div>
        <span className="bg-red-600/90 text-white text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap">{c.startTime}–{c.endTime}</span>
      </div>
      <div className="text-xs text-white/70 mt-1 flex items-center gap-1">
        <span className="truncate">{c.location}</span>
        <span>•</span>
        <span className="truncate">{c.instructorName}</span>
      </div>
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t: any) => (
            <span key={t.key} className={`text-[10px] px-2 py-0.5 rounded-full ${t.variant === 'red' ? 'bg-red-600/90 text-white' : 'bg-white/10 text-white/80 border border-white/15'}`}>{t.label}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function LegendBar() {
  const items = [
    { label: 'PRO', desc: 'Pro practice', variant: 'red' },
    { label: '6M+', desc: '6 months experience', variant: 'neutral' },
    { label: 'Ages 7+', desc: 'Kids eligibility', variant: 'neutral' },
    { label: 'Invite', desc: 'Invite only', variant: 'neutral' },
    { label: 'Beginners', desc: 'Beginners friendly', variant: 'neutral' },
    { label: 'All levels', desc: 'All levels welcome', variant: 'neutral' },
  ]
  return (
    <div className="col-span-full mt-4 border border-white/10 rounded-lg bg-white/5 p-3">
      <div className="flex flex-wrap gap-2 items-center">
        {items.map(i => (
          <div key={i.label} className="flex items-center gap-2 text-xs text-white/70">
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${i.variant === 'red' ? 'bg-red-600/90 text-white' : 'bg-white/10 text-white/80 border border-white/15'}`}>{i.label}</span>
            <span className="hidden sm:inline">{i.desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function parseTags(c: any) {
  const source = `${c.description || ''} ${c.name || ''}`.toLowerCase()
  const tags: Array<{ key: string; label: string; variant: 'red' | 'neutral' }> = []
  if (/(^|\s)pro(\s|$)/.test(source) || source.includes('pro ')) tags.push({ key: 'pro', label: 'PRO', variant: 'red' })
  if (source.includes('6m+') || source.includes('6 months')) tags.push({ key: '6m', label: '6M+', variant: 'neutral' })
  if (source.includes('ages 7')) tags.push({ key: 'ages', label: 'Ages 7+', variant: 'neutral' })
  if (source.includes('invite')) tags.push({ key: 'invite', label: 'Invite', variant: 'neutral' })
  if (source.includes('beginner')) tags.push({ key: 'beg', label: 'Beginners', variant: 'neutral' })
  if (source.includes('all levels')) tags.push({ key: 'all', label: 'All levels', variant: 'neutral' })
  return tags
}

function fullDayName(n: number) {
  const map = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return map[n] || ''
}

function getFallbackTimetable() {
  // Representative static schedule matching your shared image (minimal)
  const to = (d: number, name: string, start: string, end: string, instructor: string, location: string) => ({
    id: `${d}-${name}-${start}`,
    name,
    description: '',
    instructorName: instructor,
    dayOfWeek: d,
    startTime: start,
    endTime: end,
    duration: 60,
    maxParticipants: 30,
    location,
    serviceName: 'Martial Arts'
  })

  return [
    // Monday
    to(1,'Morning Class','06:30','07:30','Staff','Main Gym'),
    to(1,'Kids Striking','17:30','18:30','Kids Coach','Main Gym'),
    to(1,'Beginners No Gi BJJ','18:30','19:30','Coach','Mat Area 1'),
    to(1,'Intermediate No Gi BJJ','18:30','19:30','Coach','Mat Area 2'),
    to(1,'Gi BJJ','19:30','21:00','Coach','Mat Area 1'),
    // Tuesday
    to(2,'Morning Class','06:30','07:30','Staff','Main Gym'),
    to(2,'No Gi BJJ','11:00','12:30','Dani','Mat Area 1'),
    to(2,'Submission Grappling','18:30','19:45','Dani','Mat Area 1'),
    to(2,'Adult MMA','19:45','21:00','Qudrat','Main Gym'),
    to(2,'Masters BJJ','21:30','22:30','Top Black Belt','Mat Area 1'),
    // Wednesday
    to(3,'Beginners No Gi Sparring','18:00','19:00','Coach','Mat Area 1'),
    to(3,'Adult Striking','19:00','20:00','Qudrat','Main Gym'),
    // Thursday
    to(4,'Submission Grappling','18:30','19:45','Dani','Mat Area 1'),
    to(4,'Adult MMA','19:45','21:00','Qudrat','Main Gym'),
    to(4,'Masters BJJ','21:30','22:30','Top Black Belt','Mat Area 2'),
    // Friday
    to(5,'Kids Gi BJJ','17:30','18:30','Kids Coach','Mat Area 1'),
    to(5,'Beginners No Gi BJJ','18:30','19:30','Coach','Mat Area 1'),
    to(5,'Gi BJJ','19:30','21:00','Dani','Mat Area 1'),
    // Saturday
    to(6,'Kids Striking','10:00','11:00','Kids Coach','Main Gym'),
    to(6,'10 Rounds BJJ Sparring','19:00','20:00','Coach','Mat Area 1'),
    // Sunday
    to(0,'Adult Striking','19:00','20:00','Qudrat','Main Gym'),
  ]
}

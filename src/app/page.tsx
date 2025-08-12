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
import { useState } from "react";

const businesses = [
  {
    id: 'aura_mma',
    name: 'Aura MMA',
    description: 'Premier martial arts training facility',
    icon: Dumbbell,
    color: 'bg-gradient-to-br from-red-500 to-red-600',
    offerings: ['World class grappling', 'Elite level striking coaching', 'Professional MMA fighters and coaches', 'National Champions Wrestling coach', 'World class Strength and Conditioning Facility'],
    membershipTypes: [
      { name: 'Full Access', price: MEMBERSHIP_PLANS.FULL_ADULT.monthlyPrice, popular: true },
      { name: 'Weekend Warrior', price: MEMBERSHIP_PLANS.WEEKEND_ADULT.monthlyPrice, popular: false },
      { name: 'Full Youth', price: MEMBERSHIP_PLANS.FULL_UNDER18.monthlyPrice, popular: false },
      { name: 'Weekend Youth', price: MEMBERSHIP_PLANS.WEEKEND_UNDER18.monthlyPrice, popular: false },
      { name: 'Masters Program (30+)', price: MEMBERSHIP_PLANS.MASTERS.monthlyPrice, popular: false }
    ]
  },
  {
    id: 'aura_womens',
    name: "Aura Women's Gym",
    description: 'Top calibre womens muay thai training',
    icon: Heart,
    color: 'bg-gradient-to-br from-pink-500 to-pink-600',
    offerings: ['Muay Thai Only', 'Women-Only Classes', 'Elite Female Coaching', 'Technique-Focused Training'],
    membershipTypes: [
      { name: "Women's Muay Thai", price: MEMBERSHIP_PLANS.WOMENS_CLASSES.monthlyPrice, popular: true }
    ]
  }
];

export default function Home() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
              Welcome to <span className="bg-gradient-to-r from-red-400 to-pink-400 bg-clip-text text-transparent">Aura MMA</span>
            </h1>
            <p className="text-lg sm:text-xl text-white/70 max-w-2xl mx-auto leading-relaxed">
              A collaboration by friends to spread the martial arts lifestyle in the community
            </p>
          </div>

          {/* Tagline */}
          <div className="pt-8">
            <p className="text-base sm:text-lg font-medium text-white/90">
              One of the UK's top martial arts facilities
            </p>
          </div>
        </div>
      </section>

      {/* Business Selection */}
      <section className="relative py-16 sm:py-24">
        <div className="container mx-auto px-4 sm:px-6 space-y-12">
          <div className="text-center space-y-6">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-tight">
              Choose Your <span className="bg-gradient-to-r from-red-400 to-pink-400 bg-clip-text text-transparent">Fitness Journey</span>
            </h2>
            <p className="text-lg sm:text-xl text-white/70 max-w-3xl mx-auto leading-relaxed">
              Each membership plan is designed to bring you closer to your combat sport goals
            </p>
          </div>

          <div className="grid gap-8 lg:grid-cols-2 max-w-6xl mx-auto">
            {businesses.map((business) => {
              const IconComponent = business.icon;
              return (
                <Link key={business.id} href={`/register?business=${business.id}`}>
                  <Card className="group bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-500 cursor-pointer backdrop-blur-sm">
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
                            <div key={index} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10">
                              <span className="flex items-center gap-2 text-white">
                                {membership.name}
                                {membership.popular && (
                                  <Badge className="bg-gradient-to-r from-red-500 to-pink-500 text-white text-xs border-0">Popular</Badge>
                                )}
                              </span>
                              <span className="font-bold text-white">£{membership.price}<span className="text-sm text-white/60">/mo</span></span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* CTA Button */}
                      <Button className="w-full bg-white text-black hover:bg-white/90 font-semibold text-base py-6 rounded-xl transition-all duration-300 group-hover:shadow-lg group-hover:shadow-white/20">
                        Join {business.name}
                        <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
                      </Button>
                    </CardContent>
                  </Card>
                </Link>
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

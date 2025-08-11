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
  CheckCircle2
} from "lucide-react";
import { MEMBERSHIP_PLANS } from "@/config/memberships";

const businesses = [
  {
    id: 'aura_mma',
    name: 'Aura MMA',
    description: 'Premier martial arts training facility',
    icon: Dumbbell,
    color: 'bg-red-500',
    offerings: ['Brazilian Jiu-Jitsu', 'MMA Training', 'Boxing', 'Muay Thai'],
    membershipTypes: [
      { name: 'Weekend Warrior', price: MEMBERSHIP_PLANS.WEEKEND_ADULT.monthlyPrice, popular: false },
      { name: 'Full Access', price: MEMBERSHIP_PLANS.FULL_ADULT.monthlyPrice, popular: true }
    ]
  },
  {
    id: 'aura_womens',
    name: "Aura Women's Gym",
    description: 'Dedicated women-only fitness space',
    icon: Heart,
    color: 'bg-pink-500',
    offerings: ['Women-Only Classes', 'Self-Defense', 'Yoga & Pilates', 'Strength Training'],
    membershipTypes: [
      { name: "Women's Program", price: MEMBERSHIP_PLANS.WOMENS_CLASSES.monthlyPrice, popular: true }
    ]
  }
];

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      {/* Navigation */}
      <nav className="container mx-auto p-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">P</span>
          </div>
          <span className="text-xl font-bold">Portal365</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/auth/signin">
            <Button variant="outline">Customer Login</Button>
          </Link>
          <Link href="/auth/signin">
            <Button variant="outline">Admin Login</Button>
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-6 py-16 text-center space-y-8">
        <Badge className="mx-auto">
          <Star className="h-3 w-3 mr-1" />
          Multi-Business Platform
        </Badge>
        
        <div className="space-y-4 max-w-4xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight">
            Welcome to Aura MMA
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Choose from our premium fitness and wellness businesses. 
            One platform, multiple specialized services tailored to your goals.
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid gap-8 md:grid-cols-3 max-w-2xl mx-auto pt-8">
          <div className="text-center space-y-2">
            <div className="text-3xl font-bold">2</div>
            <p className="text-sm text-muted-foreground">Specialized Businesses</p>
          </div>
          <div className="text-center space-y-2">
            <div className="text-3xl font-bold">500+</div>
            <p className="text-sm text-muted-foreground">Active Members</p>
          </div>
          <div className="text-center space-y-2">
            <div className="text-3xl font-bold">99%</div>
            <p className="text-sm text-muted-foreground">Satisfaction Rate</p>
          </div>
        </div>
      </section>

      {/* Business Selection */}
      <section className="container mx-auto px-6 py-16 space-y-12">
        <div className="text-center space-y-4">
          <h2 className="text-3xl md:text-4xl font-bold">
            Choose Your Fitness Journey
          </h2>
          <p className="text-xl text-muted-foreground">
            Each business specializes in different aspects of fitness and wellness
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-2 max-w-6xl mx-auto">
          {businesses.map((business) => {
            const IconComponent = business.icon;
            return (
              <Link key={business.id} href={`/register?business=${business.id}`}>
                <Card 
                  className="group hover:shadow-lg transition-all duration-300 cursor-pointer border-2 hover:border-primary/50"
                >
                  <CardHeader className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-lg ${business.color} text-white`}>
                        <IconComponent className="h-6 w-6" />
                      </div>
                      <div>
                        <CardTitle className="text-xl">{business.name}</CardTitle>
                        <CardDescription className="text-base">
                          {business.description}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                
                  <CardContent className="space-y-6">
                    {/* Offerings */}
                    <div className="space-y-3">
                      <h4 className="font-semibold text-sm">What's Included:</h4>
                      <div className="grid gap-2">
                        {business.offerings.map((offering, index) => (
                          <div key={index} className="flex items-center gap-2 text-sm">
                            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                            <span>{offering}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Membership Options */}
                    <div className="space-y-3">
                      <h4 className="font-semibold text-sm">Membership Options:</h4>
                      <div className="space-y-2">
                        {business.membershipTypes.map((membership, index) => (
                          <div key={index} className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2">
                              {membership.name}
                              {membership.popular && (
                                <Badge variant="secondary" className="text-xs">Popular</Badge>
                              )}
                            </span>
                            <span className="font-semibold">£{membership.price}/mo</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* CTA Button */}
                    <Button className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      Join {business.name}
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>

        <div className="text-center pt-8">
          <p className="text-muted-foreground mb-4">
            Not sure which business is right for you?
          </p>
          <Button variant="outline" size="lg">
            Compare All Options
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-muted/30">
        <div className="container mx-auto px-6 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-primary rounded flex items-center justify-center">
                <span className="text-white font-bold text-xs">P</span>
              </div>
              <span className="font-semibold">Portal365</span>
            </div>
            <div className="text-sm text-muted-foreground">
              Multi-business fitness platform
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  Calendar, 
  Clock, 
  Users, 
  MapPin, 
  Plus, 
  Edit, 
  Trash2, 
  Save,
  X,
  ArrowLeft,
  UserCheck,
  Target,
  Loader2
} from 'lucide-react'

interface ClassData {
  id: string
  name: string
  description: string
  instructorName: string
  dayOfWeek: number
  startTime: string
  endTime: string
  duration: number
  maxParticipants: number
  location: string
  isActive: boolean
  requiredMemberships: string[]
  ageRestrictions?: string
}

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' }
]

const MEMBERSHIP_TYPES = [
  { value: 'WEEKEND_ADULT', label: 'Weekend Only Membership' },
  { value: 'FULL_ADULT', label: 'Full Adult' },
  { value: 'KIDS_WEEKEND_UNDER14', label: 'Kids Weekend (Under 14s)' },
  { value: 'KIDS_UNLIMITED_UNDER14', label: 'Kids Unlimited (Under 14s)' },
  { value: 'MASTERS', label: 'Masters Program (30+)' },
  { value: 'PERSONAL_TRAINING', label: 'Personal Training' },
  { value: 'WOMENS_CLASSES', label: 'Women\'s Classes' },
  { value: 'WELLNESS_PACKAGE', label: 'Wellness Package' }
]

const LOCATIONS = [
  'Main Gym',
  'Mat Area 1',
  'Mat Area 2', 
  'Boxing Ring',
  'Octagon',
  'Training Area 2',
  'Wellness Room',
  'Outdoor Area'
]

export default function AdminClassesPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [classes, setClasses] = useState<ClassData[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Form state for new/edit class
  const [formData, setFormData] = useState<Partial<ClassData>>({
    name: '',
    description: '',
    instructorName: '',
    dayOfWeek: 1,
    startTime: '19:00',
    endTime: '20:00',
    duration: 60,
    maxParticipants: 20,
    location: 'Main Gym',
    isActive: true,
    requiredMemberships: ['FULL_ADULT'],
    ageRestrictions: ''
  })

  useEffect(() => {
    if (status === 'loading') return
    
    if (!session) {
      router.push('/auth/signin')
      return
    }
    
    const user = session?.user as any
    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
      router.push('/dashboard')
      return
    }
    
    fetchClasses()
  }, [session, status])

  const fetchClasses = async () => {
    try {
      const response = await fetch('/api/admin/classes')
      const data = await response.json()
      
      if (data.success) {
        setClasses(data.classes)
      } else {
        setError(data.error || 'Failed to load classes')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (classData: Partial<ClassData>) => {
    try {
      setError(null)
      
      const endpoint = editing ? `/api/admin/classes/${editing}` : '/api/admin/classes'
      const method = editing ? 'PUT' : 'POST'
      
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...classData,
          duration: parseInt(classData.startTime?.split(':')[1] || '0') - parseInt(classData.endTime?.split(':')[1] || '0') || 60
        })
      })
      
      const data = await response.json()
      
      if (data.success) {
        setSuccess(editing ? 'Class updated successfully!' : 'Class created successfully!')
        setEditing(null)
        setShowAddForm(false)
        setFormData({
          name: '',
          description: '',
          instructorName: '',
          dayOfWeek: 1,
          startTime: '19:00',
          endTime: '20:00',
          duration: 60,
          maxParticipants: 20,
          location: 'Main Gym',
          isActive: true,
          requiredMemberships: ['FULL_ADULT'],
          ageRestrictions: ''
        })
        await fetchClasses()
        
        setTimeout(() => setSuccess(null), 3000)
      } else {
        setError(data.error || 'Failed to save class')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    }
  }

  const handleDelete = async (classId: string) => {
    if (!confirm('Are you sure you want to delete this class? This action cannot be undone.')) {
      return
    }
    
    try {
      const response = await fetch(`/api/admin/classes/${classId}`, {
        method: 'DELETE'
      })
      
      const data = await response.json()
      
      if (data.success) {
        setSuccess('Class deleted successfully!')
        await fetchClasses()
        setTimeout(() => setSuccess(null), 3000)
      } else {
        setError(data.error || 'Failed to delete class')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    }
  }

  const startEdit = (classData: ClassData) => {
    setFormData({
      ...classData,
      requiredMemberships: classData.requiredMemberships || []
    })
    setEditing(classData.id)
    setShowAddForm(false)
  }

  const getDayName = (dayOfWeek: number) => {
    return DAYS_OF_WEEK.find(d => d.value === dayOfWeek)?.label || 'Unknown'
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-6xl">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto" />
          <p className="mt-2 text-muted-foreground">Loading classes...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.push('/admin')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Admin
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Class Timetable Management</h1>
            <p className="text-muted-foreground">Manage class schedules, instructors, and access permissions</p>
          </div>
        </div>
        <Button onClick={() => setShowAddForm(true)} disabled={editing !== null}>
          <Plus className="h-4 w-4 mr-2" />
          Add New Class
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="border-green-500/20 bg-green-500/10">
          <AlertDescription className="text-green-300">{success}</AlertDescription>
        </Alert>
      )}

      {/* Add/Edit Form */}
      {(showAddForm || editing) && (
        <Card className="border-blue-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              {editing ? 'Edit Class' : 'Add New Class'}
            </CardTitle>
            <CardDescription>
              {editing ? 'Update class details and permissions' : 'Create a new class with schedule and access permissions'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ClassForm 
              formData={formData}
              setFormData={setFormData}
              onSave={handleSave}
              onCancel={() => {
                setEditing(null)
                setShowAddForm(false)
                setFormData({
                  name: '',
                  description: '',
                  instructorName: '',
                  dayOfWeek: 1,
                  startTime: '19:00',
                  endTime: '20:00',
                  duration: 60,
                  maxParticipants: 20,
                  location: 'Main Gym',
                  isActive: true,
                  requiredMemberships: ['FULL_ADULT'],
                  ageRestrictions: ''
                })
              }}
              isEditing={editing !== null}
            />
          </CardContent>
        </Card>
      )}

      {/* Classes List */}
      <div className="grid gap-4">
        {classes.map((classItem) => (
          <Card key={classItem.id} className={`${!classItem.isActive ? 'opacity-60' : ''}`}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold">{classItem.name}</h3>
                    <Badge variant={classItem.isActive ? 'default' : 'secondary'}>
                      {classItem.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  
                  <p className="text-muted-foreground">{classItem.description}</p>
                  
                  <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span>{getDayName(classItem.dayOfWeek)} {classItem.startTime} - {classItem.endTime}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span>Max {classItem.maxParticipants} participants</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span>{classItem.location}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <UserCheck className="h-4 w-4 text-muted-foreground" />
                      <span>{classItem.instructorName}</span>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Access Permissions:</p>
                    <div className="flex flex-wrap gap-2">
                      {classItem.requiredMemberships.map((membership) => (
                        <Badge key={membership} variant="outline" className="text-xs">
                          {MEMBERSHIP_TYPES.find(m => m.value === membership)?.label || membership}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => startEdit(classItem)}
                    disabled={editing !== null}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(classItem.id)}
                    disabled={editing !== null}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {classes.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Classes Found</h3>
            <p className="text-muted-foreground mb-4">
              Get started by creating your first class schedule.
            </p>
            <Button onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Class
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ClassForm({ 
  formData, 
  setFormData, 
  onSave, 
  onCancel, 
  isEditing 
}: {
  formData: Partial<ClassData>
  setFormData: (data: Partial<ClassData>) => void
  onSave: (data: Partial<ClassData>) => void
  onCancel: () => void
  isEditing: boolean
}) {
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await onSave(formData)
    setSaving(false)
  }

  const handleMembershipChange = (membership: string, checked: boolean) => {
    const current = formData.requiredMemberships || []
    const updated = checked 
      ? [...current, membership]
      : current.filter(m => m !== membership)
    
    setFormData({ ...formData, requiredMemberships: updated })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Basic Information */}
        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Class Name *</Label>
            <Input
              id="name"
              value={formData.name || ''}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Brazilian Jiu-Jitsu Fundamentals"
              required
            />
          </div>
          
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of the class"
              rows={3}
            />
          </div>
          
          <div>
            <Label htmlFor="instructor">Instructor Name *</Label>
            <Input
              id="instructor"
              value={formData.instructorName || ''}
              onChange={(e) => setFormData({ ...formData, instructorName: e.target.value })}
              placeholder="e.g., John Smith"
              required
            />
          </div>
          
          <div>
            <Label htmlFor="location">Location *</Label>
            <Select
              value={formData.location}
              onValueChange={(value) => setFormData({ ...formData, location: value })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {LOCATIONS.map(location => (
                  <SelectItem key={location} value={location}>
                    {location}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Schedule & Capacity */}
        <div className="space-y-4">
          <div>
            <Label htmlFor="dayOfWeek">Day of Week *</Label>
            <Select
              value={formData.dayOfWeek?.toString() || '1'}
              onValueChange={(value) => setFormData({ ...formData, dayOfWeek: parseInt(value) })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select day" />
              </SelectTrigger>
              <SelectContent>
                {DAYS_OF_WEEK.map(day => (
                  <SelectItem key={day.value} value={day.value.toString()}>
                    {day.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="startTime">Start Time *</Label>
              <Input
                id="startTime"
                type="time"
                value={formData.startTime || '19:00'}
                onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                required
              />
            </div>
            <div>
              <Label htmlFor="endTime">End Time *</Label>
              <Input
                id="endTime"
                type="time"
                value={formData.endTime || '20:00'}
                onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                required
              />
            </div>
          </div>
          
          <div>
            <Label htmlFor="maxParticipants">Max Participants *</Label>
            <Input
              id="maxParticipants"
              type="number"
              min="1"
              max="100"
              value={formData.maxParticipants || 20}
              onChange={(e) => setFormData({ ...formData, maxParticipants: parseInt(e.target.value) })}
              required
            />
          </div>
          
          <div className="flex items-center space-x-2">
            <Checkbox
              id="isActive"
              checked={formData.isActive !== false}
              onCheckedChange={(checked: boolean) => setFormData({ ...formData, isActive: checked })}
            />
            <Label htmlFor="isActive">Class is active</Label>
          </div>
        </div>
      </div>

      {/* Access Permissions */}
      <div className="space-y-4">
        <h4 className="font-semibold flex items-center gap-2">
          <Target className="h-4 w-4" />
          Access Permissions
        </h4>
        <p className="text-sm text-muted-foreground">
          Select which membership types can access this class
        </p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {MEMBERSHIP_TYPES.map(membership => (
            <div key={membership.value} className="flex items-center space-x-2">
              <Checkbox
                id={membership.value}
                checked={formData.requiredMemberships?.includes(membership.value) || false}
                onCheckedChange={(checked: boolean) => handleMembershipChange(membership.value, checked)}
              />
              <Label htmlFor={membership.value} className="text-sm">
                {membership.label}
              </Label>
            </div>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end gap-3 pt-6 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>
          <X className="h-4 w-4 mr-2" />
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {isEditing ? 'Update Class' : 'Create Class'}
        </Button>
      </div>
    </form>
  )
} 
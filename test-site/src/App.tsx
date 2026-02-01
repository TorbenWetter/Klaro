import { useState, useEffect, useCallback } from 'react'
import './App.css'

// Simulating CSS-in-JS random class names
const cx = (...parts: string[]) => parts.map(p => `_${p}_${Math.random().toString(36).slice(2, 6)}`).join(' ')

// Generate a "stable" but ugly class name that includes the word (for CSS matching)
const hash = (s: string) => `_${s}_${Math.abs(s.split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0)).toString(36)}`

interface Sponsor {
  id: number
  name: string
}

interface ScheduleItem {
  time: string
  event: string
  id: number
}

const SPONSORS: Sponsor[] = [
  { id: 1, name: 'Cursor' },
  { id: 2, name: 'OpenAI' },
  { id: 3, name: 'Google Gemini' },
  { id: 4, name: 'Manus' },
  { id: 5, name: 'Hume AI' },
  { id: 6, name: 'ElevenLabs' },
  { id: 7, name: 'n8n' },
  { id: 8, name: 'LangChain' },
  { id: 9, name: 'Runway' },
  { id: 10, name: 'Miro' },
  { id: 11, name: 'v0' },
  { id: 12, name: 'MiniMax' },
]

const SCHEDULE_DAY1: ScheduleItem[] = [
  { id: 101, time: '09:00', event: 'Doors open, breakfast' },
  { id: 102, time: '10:30', event: 'Registration closes' },
  { id: 103, time: '11:00', event: 'Team formation' },
  { id: 104, time: '11:20', event: 'Building begins' },
  { id: 105, time: '13:00', event: 'Lunch break' },
  { id: 106, time: '18:00', event: 'Dinner' },
  { id: 107, time: '23:00', event: 'Day 1 ends' },
]

const SCHEDULE_DAY2: ScheduleItem[] = [
  { id: 201, time: '09:00', event: 'Continue building' },
  { id: 202, time: '14:00', event: 'Submission deadline' },
  { id: 203, time: '15:00', event: 'Judging begins' },
  { id: 204, time: '17:00', event: 'Finalists announced' },
  { id: 205, time: '17:30', event: 'Finalist pitches' },
  { id: 206, time: '18:30', event: 'Winners announced' },
  { id: 207, time: '19:00', event: 'Event ends' },
]

function App() {
  const [attendeeCount, setAttendeeCount] = useState(387)
  const [activeTab, setActiveTab] = useState<'about' | 'schedule' | 'prizes'>('about')
  const [scheduleDay, setScheduleDay] = useState<1 | 2>(1)
  const [showModal, setShowModal] = useState(false)
  const [formData, setFormData] = useState({ name: '', email: '', team: '' })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [sponsors, setSponsors] = useState(SPONSORS)
  const [countdown, setCountdown] = useState({ hours: 0, minutes: 0, seconds: 0 })
  const [announcementIndex, setAnnouncementIndex] = useState(0)
  const [renderKey, setRenderKey] = useState(0)
  const [showBanner, setShowBanner] = useState(true)
  const [ctaVariant, setCtaVariant] = useState(0)
  const [statsOrder, setStatsOrder] = useState<('attendees' | 'countdown' | 'cta')[]>(['attendees', 'countdown', 'cta'])
  const [placeholderVariant, setPlaceholderVariant] = useState(0)

  // CTA text variants - button text changes slightly
  const ctaTexts = ['Register Now', 'Join Now', 'Sign Up', 'Get Started', 'Reserve Spot']

  // Placeholder variants - form placeholders change
  const placeholders = {
    name: ['Enter your name', 'Your full name', 'Name here', 'Full name'],
    email: ['your@email.com', 'Email address', 'Enter email', 'you@example.com'],
    team: ['Your team name', 'Team name (optional)', 'Enter team', 'Team']
  }

  const announcements = [
    'New sponsor announced: MiniMax joins as Gold tier!',
    'Prize pool increased to $280,000+',
    'Limited spots remaining - register now!',
    'Judges from Amazon, Apple, and Netflix confirmed',
    'Free food and drinks for all participants',
  ]

  // Countdown timer - causes frequent re-renders (until submission deadline)
  // Sunday Feb 1, 2026 at 14:00 CET (German time = UTC+1)
  useEffect(() => {
    const hackathonEnd = new Date(Date.UTC(2026, 1, 1, 13, 0, 0)) // 14:00 CET = 13:00 UTC
    const timer = setInterval(() => {
      const now = new Date()
      const diff = hackathonEnd.getTime() - now.getTime()
      if (diff > 0) {
        setCountdown({
          hours: Math.floor(diff / (1000 * 60 * 60)),
          minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
          seconds: Math.floor((diff % (1000 * 60)) / 1000),
        })
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Simulate live attendee updates - triggers re-render
  useEffect(() => {
    const timer = setInterval(() => {
      setAttendeeCount(c => c + Math.floor(Math.random() * 3))
    }, 5000)
    return () => clearInterval(timer)
  }, [])

  // Rotate announcements
  useEffect(() => {
    const timer = setInterval(() => {
      setAnnouncementIndex(i => (i + 1) % announcements.length)
    }, 4000)
    return () => clearInterval(timer)
  }, [announcements.length])

  // Shuffle sponsors periodically - causes complete DOM replacement
  useEffect(() => {
    const timer = setInterval(() => {
      setSponsors(s => [...s].sort(() => Math.random() - 0.5))
      setRenderKey(k => k + 1) // Force complete re-render
    }, 8000)
    return () => clearInterval(timer)
  }, [])

  // Change CTA button text - same button, different text
  useEffect(() => {
    const timer = setInterval(() => {
      setCtaVariant(v => (v + 1) % ctaTexts.length)
    }, 6000)
    return () => clearInterval(timer)
  }, [ctaTexts.length])

  // Shuffle stats order - elements change visual position
  useEffect(() => {
    const timer = setInterval(() => {
      setStatsOrder(order => [...order].sort(() => Math.random() - 0.5))
    }, 10000)
    return () => clearInterval(timer)
  }, [])

  // Change form placeholders - makes placeholder-based matching unreliable
  useEffect(() => {
    const timer = setInterval(() => {
      setPlaceholderVariant(v => (v + 1) % 4)
    }, 7000)
    return () => clearInterval(timer)
  }, [])

  const validateForm = useCallback(() => {
    const errors: Record<string, string> = {}
    if (!formData.name) errors.name = 'Required'
    if (!formData.email) errors.email = 'Required'
    else if (!formData.email.includes('@')) errors.email = 'Invalid email'
    if (formData.team && formData.team.length < 2) errors.team = 'Too short'
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }, [formData])

  const handleSubmit = () => {
    if (validateForm()) {
      setShowModal(false)
      alert('Registration submitted!')
    }
  }

  const schedule = scheduleDay === 1 ? SCHEDULE_DAY1 : SCHEDULE_DAY2

  return (
    // No semantic elements, random class names, no aria attributes
    <div className={hash('container')} key={renderKey}>
      {/* Announcement banner - changes content */}
      {showBanner && (
        <div className={cx('banner', 'top')}>
          <span className={hash('marquee')}>{announcements[announcementIndex]}</span>
          <span className={hash('close')} onClick={() => setShowBanner(false)}>x</span>
        </div>
      )}


      {/* Hero section with countdown - stats order changes dynamically */}
      <div className={hash('hero')}>
        <div className={hash('herocontent')}>
          <div className={hash('bigtitle')}>Germany's Biggest AI Hackathon</div>
          <div className={hash('subtitle')}>January 31 - February 1, 2026 | Bucerius Law School</div>

          {/* Stats rendered in dynamic order - visual position changes */}
          <div className={hash('stats')}>
            {statsOrder.map((stat, idx) => {
              if (stat === 'attendees') {
                return (
                  <div key={`stat-${idx}-${renderKey}`} className={hash('attendees')}>
                    <span className={cx('count')}>{attendeeCount}</span>
                    <span className={hash('label')}>hackers registered</span>
                  </div>
                )
              }
              if (stat === 'countdown') {
                return (
                  <div key={`stat-${idx}-${renderKey}`} className={hash('countdownwrap')}>
                    <div className={hash('countdownlabel')}>Until Submission Deadline</div>
                    <div className={hash('countdown')}>
                      <div className={cx('unit')}>
                        <span className={hash('num')}>{countdown.hours}</span>
                        <span className={hash('lbl')}>hours</span>
                      </div>
                      <div className={cx('unit')}>
                        <span className={hash('num')}>{countdown.minutes}</span>
                        <span className={hash('lbl')}>min</span>
                      </div>
                      <div className={cx('unit')}>
                        <span className={hash('num')}>{countdown.seconds}</span>
                        <span className={hash('lbl')}>sec</span>
                      </div>
                    </div>
                  </div>
                )
              }
              if (stat === 'cta') {
                return (
                  <div key={`stat-${idx}-${renderKey}`} className={hash('cta')} onClick={() => setShowModal(true)}>
                    {ctaTexts[ctaVariant]}
                  </div>
                )
              }
              return null
            })}
          </div>
        </div>
      </div>

      {/* Tab content area */}
      <div className={hash('tabs')}>
        <div className={hash('tabbar')}>
          {(['about', 'schedule', 'prizes'] as const).map(tab => (
            <span
              key={tab}
              className={`${hash('tab')} ${activeTab === tab ? hash('active') : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </span>
          ))}
        </div>

        <div className={hash('tabcontent')}>
          {activeTab === 'about' && (
            <div className={cx('section', 'about')}>
              <div className={hash('sectiontitle')}>About the Event</div>
              <div className={hash('text')}>
                Join 400+ developers, designers, and entrepreneurs for 48 hours of intense building.
                Use Cursor, Claude, GPT, or any AI tool to create something amazing.
                Non-technical participants welcome - we value shipping over polish!
              </div>
              <div className={hash('features')}>
                <div className={cx('feature')}>
                  <span className={hash('ficon')}>$</span>
                  <span className={hash('ftitle')}>$280,000+ in Prizes</span>
                  <span className={hash('fdesc')}>Cash and credits from top AI companies</span>
                </div>
                <div className={cx('feature')}>
                  <span className={hash('ficon')}>!</span>
                  <span className={hash('ftitle')}>Free Entry</span>
                  <span className={hash('fdesc')}>Food, drinks, and swag included</span>
                </div>
                <div className={cx('feature')}>
                  <span className={hash('ficon')}>*</span>
                  <span className={hash('ftitle')}>Expert Judges</span>
                  <span className={hash('fdesc')}>From Amazon, Apple, Netflix</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'schedule' && (
            <div className={cx('section', 'schedule')}>
              <div className={hash('sectiontitle')}>Schedule</div>
              <div className={hash('daytabs')}>
                <span
                  className={`${hash('daytab')} ${scheduleDay === 1 ? hash('active') : ''}`}
                  onClick={() => setScheduleDay(1)}
                >
                  Saturday
                </span>
                <span
                  className={`${hash('daytab')} ${scheduleDay === 2 ? hash('active') : ''}`}
                  onClick={() => setScheduleDay(2)}
                >
                  Sunday
                </span>
              </div>
              <div className={hash('schedulelist')}>
                {schedule.map((item, idx) => (
                  // Key changes based on day - forces DOM replacement
                  <div key={`${scheduleDay}-${item.id}-${idx}`} className={cx('scheduleitem')}>
                    <span className={hash('time')}>{item.time}</span>
                    <span className={hash('event')}>{item.event}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'prizes' && (
            <div className={cx('section', 'prizes')}>
              <div className={hash('sectiontitle')}>Prize Pool</div>
              <div className={hash('prizelist')}>
                <div className={cx('prize', 'first')}>
                  <span className={hash('place')}>1st</span>
                  <span className={hash('amount')}>$5,000 + $43,500 credits</span>
                  <span className={hash('details')}>Cash plus OpenAI, Anthropic, and more</span>
                </div>
                <div className={cx('prize', 'second')}>
                  <span className={hash('place')}>2nd</span>
                  <span className={hash('amount')}>$5,000 in credits</span>
                  <span className={hash('details')}>OpenAI credits and subscriptions</span>
                </div>
                <div className={cx('prize', 'third')}>
                  <span className={hash('place')}>3rd</span>
                  <span className={hash('amount')}>$1,000 in credits</span>
                  <span className={hash('details')}>Plus premium tool access</span>
                </div>
              </div>
              <div className={hash('tracks')}>
                <div className={hash('tracktitle')}>Sponsor Tracks</div>
                <div className={hash('tracklist')}>
                  {['Gemini', 'ElevenLabs', 'n8n', 'Manus', 'LangChain', 'v0', 'MiniMax'].map((track, i) => (
                    <span key={`track-${i}`} className={cx('track')}>{track}</span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sponsors section - shuffles periodically */}
      <div className={hash('sponsors')}>
        <div className={hash('sectiontitle')}>Powered By</div>
        <div className={hash('sponsorgrid')}>
          {sponsors.map((sponsor, index) => (
            // Key includes index AND random - forces replacement on shuffle
            <div
              key={`sponsor-${sponsor.id}-${index}-${renderKey}`}
              className={cx('sponsor')}
            >
              <span className={hash('sname')}>{sponsor.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer with social links */}
      <div className={hash('footer')}>
        <div className={hash('footercol')}>
          <span className={hash('ftitle')}>Contact</span>
          <span className={hash('flink')} onClick={() => window.open('mailto:hello@ai-beavers.com')}>Email Us</span>
          <span className={hash('flink')} onClick={() => window.open('https://discord.gg/hackathon')}>Discord</span>
        </div>
        <div className={hash('footercol')}>
          <span className={hash('ftitle')}>Legal</span>
          <span className={hash('flink')} onClick={() => alert('Privacy Policy clicked')}>Privacy Policy</span>
          <span className={hash('flink')} onClick={() => alert('Terms of Service clicked')}>Terms of Service</span>
          <span className={hash('flink')} onClick={() => alert('Code of Conduct clicked')}>Code of Conduct</span>
        </div>
        <div className={hash('footercol')}>
          <span className={hash('ftitle')}>Organizer</span>
          <span className={hash('flink')} onClick={() => window.open('https://ai-beavers.com')}>AI Beavers</span>
        </div>
      </div>

      {/* Registration Modal */}
      {showModal && (
        <div className={hash('overlay')} onClick={() => setShowModal(false)}>
          <div className={hash('dialog')} onClick={e => e.stopPropagation()}>
            <div className={hash('modaltitle')}>Register for the Hackathon</div>
            <div className={hash('modalclose')} onClick={() => setShowModal(false)}>x</div>

            <div className={hash('formgroup')}>
              <span className={hash('label')}>Full Name</span>
              <input
                className={`${hash('input')} ${formErrors.name ? hash('error') : ''}`}
                value={formData.name}
                onChange={e => setFormData(d => ({ ...d, name: e.target.value }))}
                placeholder={placeholders.name[placeholderVariant]}
              />
              {formErrors.name && <span className={hash('errmsg')}>{formErrors.name}</span>}
            </div>

            <div className={hash('formgroup')}>
              <span className={hash('label')}>Email</span>
              <input
                className={`${hash('input')} ${formErrors.email ? hash('error') : ''}`}
                value={formData.email}
                onChange={e => setFormData(d => ({ ...d, email: e.target.value }))}
                placeholder={placeholders.email[placeholderVariant]}
              />
              {formErrors.email && <span className={hash('errmsg')}>{formErrors.email}</span>}
            </div>

            <div className={hash('formgroup')}>
              <span className={hash('label')}>Team Name (optional)</span>
              <input
                className={`${hash('input')} ${formErrors.team ? hash('error') : ''}`}
                value={formData.team}
                onChange={e => setFormData(d => ({ ...d, team: e.target.value }))}
                placeholder={placeholders.team[placeholderVariant]}
              />
              {formErrors.team && <span className={hash('errmsg')}>{formErrors.team}</span>}
            </div>

            <div className={hash('formgroup')}>
              <span className={hash('label')}>Experience Level</span>
              <select className={hash('select')} defaultValue="">
                <option value="" disabled>Select your level</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="expert">Expert</option>
              </select>
            </div>

            <div className={hash('formgroup')}>
              <span className={hash('checkbox')}>
                <input type="checkbox" className={hash('check')} />
                <span className={hash('checklabel')}>I agree to the terms and conditions</span>
              </span>
            </div>

            <div className={hash('formactions')}>
              <span className={hash('cancel')} onClick={() => setShowModal(false)}>Cancel</span>
              <span className={hash('submit')} onClick={handleSubmit}>Submit Registration</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App

# Stone Rill — falling water pours from the hand as one connected column,
# breaks over dark stones and runs down them in sheets, gathers in the hollows
# between them, and drains away again.
#
# TIMBRE: the only WOOD in the set, and that is what makes it unmistakable
# among five water cues. :pluck is a Karplus-Strong string — struck, it would
# be a click, which is banned — but given a 60 ms attack the strike is gone and
# what is left is the hollow woody body of it. That is the stone. Over it sits
# a noise sheet with a long sustain and short attack: the pour, which is the
# one continuous thing in twelve cues that are otherwise all gestures.
# MOTION: a pour that thins, with two stones under it, low and panned apart,
# so the water is heard arriving somewhere rather than just happening.
with_fx :reverb, room: 0.6, mix: 0.3 do
  with_fx :lpf, cutoff: 88 do
    use_synth :cnoise
    play 60, attack: 0.12, sustain: 0.32, release: 0.4, amp: 0.92, cutoff: 80
    use_synth :pluck
    play :ds3, attack: 0.06, release: 0.4, amp: 0.72, pan: -0.25
    sleep 0.26
    play :as2, attack: 0.06, release: 0.45, amp: 0.59, pan: 0.25
  end
end

# Opal Rise — a cluster of soap bubbles, iridescent rims that ride the throw,
# then let buoyancy take over: rising, swaying, wobbling, until each pops into
# a soft ring or slips off the top.
#
# WHY THIS IS NOT PETAL FALL'S MIRROR ANY MORE
#   It was, once: the same bell, the same three notes, climbing instead of
#   falling. Neat, and wrong. What rises in water is bubbles, and bubbles are
#   not a bell played backwards — they are round, wet, and above all SEPARATE.
#   Four of them leave the bottom here and arrive at the top, and the cue is
#   four events rather than one gesture.
#
# HOW IT STAYS APART FROM THE OTHER TWO WATER CUES
#   drift-tide is a body moving sideways THROUGH water: one continuous glide,
#   noise-bedded, sliding down. night-pond is one ring widening outward under
#   an opening filter. This is the only water cue that is DISCRETE and
#   VERTICAL, and that is the whole distinction — several small arrivals, each
#   a little higher than the last. If it ever comes out smooth it has walked
#   into drift-tide, so the 0.16 s gaps between bubbles matter more than
#   anything else in the file.
#
# WHY IT IS ROUND WITHOUT BEING A PLOP
#   A plop is a transient and transients are banned here. The roundness comes
#   from the timbre and the pitch arc instead: pure sines, which have no
#   harmonics to get sharp with, each given a 45 ms attack so there is no
#   corner in the envelope — and each bending UP a scale step over 90 ms as it
#   sounds. That bend is a real bubble's own physics, and it is what makes a
#   sine wet rather than electronic.
#
# Every bubble starts where the one below it ended, so the four of them climb
# Ab major pentatonic as a ladder — C5 Eb5 F5 Ab5 Bb5 — while still arriving
# one at a time. The last is quieter and rings longer: that is the one that
# slips off the top rather than popping.
with_fx :reverb, room: 0.6, mix: 0.3 do
  with_fx :lpf, cutoff: 100 do
    use_synth :sine
    # from, to, amp, pan, release
    # Amps are calibrated, not chosen: the one-shot encoder lifts the whole
    # set by a single gain, so the balance has to be authored here. Measured
    # as max-momentary LUFS over the trimmed take, the twelve sit inside a
    # 1.1 dB window and this one has to land in it too.
    [[:c5,  :ds5, 0.16, -0.30, 0.28],
     [:ds5, :f5,  0.18,  0.25, 0.28],
     [:f5,  :gs5, 0.17, -0.15, 0.30],
     [:gs5, :as5, 0.12,  0.20, 0.45]].each do |from, to, a, p, rel|
      b = play from, attack: 0.045, decay: 0.05, sustain: 0.02, release: rel,
               amp: a, pan: p, note_slide: 0.09
      control b, note: to
      sleep 0.16
    end
  end
end

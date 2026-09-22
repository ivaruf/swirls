# Aurora Veil — an undulating band of auroral light that snakes along the
# direction it was thrown.
#
# TIMBRE: glass, but a soft wide one — :prophet with its own cutoff down at 80
# is a pad rather than a lead, so nothing about this has an edge.
# MOTION: undulation, and it is the only cue in the set whose pitch actually
# wanders rather than going one way. Eb5 -> F5 -> C5 -> Eb5, every step
# portamento, so the note never arrives anywhere: it waves, like the ribbon.
with_fx :reverb, room: 0.7, mix: 0.36 do
  with_fx :lpf, cutoff: 95 do
    use_synth :prophet
    n = play :ds5, attack: 0.3, sustain: 0.25, release: 0.7, amp: 0.31, cutoff: 80, note_slide: 0.3
    sleep 0.3
    control n, note: :f5
    sleep 0.3
    control n, note: :c5
    sleep 0.3
    control n, note: :ds5
  end
end

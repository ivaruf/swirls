# Still Orbits — motes wheel around a slowly moving, precessing centre,
# leaving orbit trails.
#
# TIMBRE: glass, at its purest — three sines and nothing else.
# MOTION: none, and that is the whole point. It is the one cue in the set that
# does not go anywhere: it opens, holds, and closes. What turns is the beating
# between Bb4 and a Bb4 eight cents sharp, which drifts in and out perhaps
# twice a second all by itself. The wheel is in the interference, not in a
# gesture, which is exactly what the effect draws.
with_fx :reverb, room: 0.72, mix: 0.34 do
  with_fx :lpf, cutoff: 92 do
    use_synth :sine
    play :ds4, attack: 0.3, sustain: 0.28, release: 0.7, amp: 0.15
    play :as4, attack: 0.35, sustain: 0.22, release: 0.7, amp: 0.10
    play note(:as4) + 0.08, attack: 0.35, sustain: 0.22, release: 0.7, amp: 0.09
  end
end

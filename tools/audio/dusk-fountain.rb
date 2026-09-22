# Dusk Fountain — a plume of water: solid ropes of it rise, crest and fall
# into the lawn, fraying into spray only where the water really breaks.
#
# TIMBRE: water, and the only cue that is filtered noise AND tone moving as
# one. The noise is the plume and the sine is its rope; they arch together.
# MOTION: an arch, the clearest gesture in the set. The cutoff climbs from 68
# to 96 and back to 70 while the tone climbs C4 -> Eb4 -> C4. The crest is the
# open filter — that is where the water frays into spray — and both ends are
# closed because that is where it is still a rope.
with_fx :reverb, room: 0.66, mix: 0.34 do
  with_fx :lpf, cutoff: 90 do
    use_synth :cnoise
    s = play 60, attack: 0.3, sustain: 0.3, release: 0.5, amp: 0.23, cutoff: 68, cutoff_slide: 0.35
    use_synth :sine
    n = play :c4, attack: 0.2, sustain: 0.3, release: 0.5, amp: 0.19, note_slide: 0.35
    sleep 0.05
    control s, cutoff: 96
    control n, note: :ds4
    sleep 0.4
    control s, cutoff: 70
    control n, note: :c4
  end
end

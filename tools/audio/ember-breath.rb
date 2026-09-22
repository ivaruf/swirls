# Ember Breath — a warm spark that flies where flicked, flutters, sheds
# embers along its arc, and gutters out.
#
# TIMBRE: breath. :hollow is the breathiest thing Sonic Pi has and the cutoff
# is the lowest in the set bar ink-eddy, so this is warm rather than bright —
# an ember, not a spark.
# MOTION: a guttering fall. The breath slides Ab4 -> F4 as it dies, and three
# triangle embers drop away behind it, each quieter than the last and each
# somewhere else in the stereo field.
with_fx :reverb, room: 0.55, mix: 0.28 do
  with_fx :lpf, cutoff: 82 do
    use_synth :hollow
    n = play :gs4, attack: 0.12, sustain: 0.1, release: 0.55, amp: 0.87, note_slide: 0.55
    control n, note: :f4
    use_synth :tri
    3.times do |i|
      play :c5, attack: 0.05, release: 0.18, amp: 0.26 - i * 0.08, pan: rrand(-0.4, 0.4)
      sleep 0.14
    end
  end
end

import java.time.LocalTime;

public class TestTime {
    public static void main(String[] args) {
        int nowMin = 18 * 60 + 2; // 18:02 UTC
        
        LocalTime horaSalida = LocalTime.of(9, 22);
        LocalTime horaLlegada = LocalTime.of(11, 42);
        
        int depLocal = horaSalida.getHour() * 60 + horaSalida.getMinute();
        int arrLocal = horaLlegada.getHour() * 60 + horaLlegada.getMinute();
        int depMin = Math.floorMod(depLocal - (-5) * 60, 1440);
        int arrMin = Math.floorMod(arrLocal - (-4) * 60, 1440); // SLLP is -4
        
        boolean overnight = depMin > arrMin;
        
        boolean inFlight = overnight
                ? (depMin <= nowMin || nowMin <= arrMin)
                : (depMin <= nowMin && nowMin <= arrMin);
        
        boolean isUpcoming = overnight
                ? (nowMin < depMin && nowMin > arrMin)
                : (nowMin < depMin);
                
        System.out.println("depLocal=" + depLocal);
        System.out.println("arrLocal=" + arrLocal);
        System.out.println("depMin=" + depMin);
        System.out.println("arrMin=" + arrMin);
        System.out.println("overnight=" + overnight);
        System.out.println("inFlight=" + inFlight);
        System.out.println("isUpcoming=" + isUpcoming);
    }
}

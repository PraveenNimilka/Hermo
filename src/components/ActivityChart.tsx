import {CartesianGrid,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {useReducedMotion} from 'motion/react';

export default function ActivityChart({data}:{data:{day:string;runs:number;verified:number}[]}) {
  const reduced=useReducedMotion();
  const fullDate=(day:string)=>new Date(day+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  const total=data.reduce((sum,row)=>sum+row.verified,0);
  return <div className="activity-chart" role="group" aria-label={`${total.toLocaleString()} verified runs over the displayed ${data.length} days`}>
    <ResponsiveContainer width="100%" height={190}>
      <LineChart data={data} accessibilityLayer margin={{left:-24,right:12,top:12,bottom:0}}>
        <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5"/>
        <XAxis dataKey="day" tickFormatter={day=>new Date(day+'T12:00:00').toLocaleDateString(undefined,{weekday:'short'})} axisLine={false} tickLine={false} tick={{fontSize:12,fill:'var(--muted)'}} dy={8}/>
        <YAxis allowDecimals={false} domain={[0,'auto']} axisLine={false} tickLine={false} tick={{fontSize:12,fill:'var(--muted)'}}/>
        <Tooltip animationDuration={reduced?0:120} contentStyle={{borderRadius:8,border:'1px solid var(--line)',background:'var(--panel)',color:'var(--ink)',boxShadow:'var(--shadow-toast)',fontSize:12}} labelFormatter={day=>fullDate(String(day))}/>
        <Line name="Verified runs" type="linear" dataKey="verified" stroke="var(--accent)" strokeWidth={2} dot={{r:3,fill:'var(--panel)',strokeWidth:2}} activeDot={{r:5}} isAnimationActive={false}/>
      </LineChart>
    </ResponsiveContainer>
    <details className="chart-data">
      <summary>View activity data</summary>
      <div className="table-scroll"><table>
        <caption>Daily verified and total runs</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Verified runs</th><th scope="col">Total runs</th></tr></thead>
        <tbody>{data.map(row=><tr key={row.day}><th scope="row">{fullDate(row.day)}</th><td>{row.verified.toLocaleString()}</td><td>{row.runs.toLocaleString()}</td></tr>)}</tbody>
      </table></div>
    </details>
  </div>;
}

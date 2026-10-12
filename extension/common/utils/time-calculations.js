// Time Calculations
function getStartTime(range, customStart = null, customEnd = null) {
  const now = new Date();

  const setStartOfDay = (d) => {
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const setEndOfDay = (d) => {
    d.setHours(23, 59, 59, 999);
    return d;
  };

  let startTime = 0;
  let endTime = now.getTime();

  if (range === "custom" && customStart) {
    return { startTime: customStart, endTime: customEnd || endTime };
  }

  switch (range) {
    case "day": {
      const d = setStartOfDay(new Date(now));
      startTime = d.getTime();
      endTime = setEndOfDay(new Date(now)).getTime();
      break;
    }

    case "yesterday": {
      const d = setStartOfDay(new Date(now));
      d.setDate(d.getDate() - 1);
      startTime = d.getTime();
      endTime = setEndOfDay(new Date(d)).getTime();
      break;
    }

    case "week": {
      const d = setStartOfDay(new Date(now));
      const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
      d.setDate(d.getDate() + diff);
      startTime = d.getTime();

      const weekEnd = new Date(d);
      weekEnd.setDate(weekEnd.getDate() + 6);
      endTime = setEndOfDay(weekEnd).getTime();
      break;
    }

    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      startTime = start.getTime();
      endTime = setEndOfDay(end).getTime();
      break;
    }

    case "lastMonth": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      startTime = start.getTime();
      endTime = setEndOfDay(end).getTime();
      break;
    }

    case "3months": {
      const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      startTime = start.getTime();
      endTime = setEndOfDay(end).getTime();
      break;
    }

    case "6months": {
      const start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      startTime = start.getTime();
      endTime = setEndOfDay(end).getTime();
      break;
    }

    case "year": {
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear(), 11, 31);
      startTime = start.getTime();
      endTime = setEndOfDay(end).getTime();
      break;
    }

    case "all": {
      startTime = 0;
      endTime = now.getTime();
      break;
    }

    default: {
      startTime = 0;
      endTime = now.getTime();
      break;
    }
  }

  return { startTime, endTime };
}
